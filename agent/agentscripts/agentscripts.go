package agentscripts

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/robfig/cron/v3"
	"github.com/spf13/afero"
	"golang.org/x/sync/errgroup"
	"golang.org/x/xerrors"
	"google.golang.org/protobuf/types/known/timestamppb"

	"cdr.dev/slog"

	"github.com/coder/coder/v2/agent/agentssh"
	"github.com/coder/coder/v2/agent/proto"
	"github.com/coder/coder/v2/coderd/database/dbtime"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/codersdk/agentsdk"
)

var (
	// ErrTimeout is returned when a script times out.
	ErrTimeout = xerrors.New("script timed out")
	// ErrOutputPipesOpen is returned when a script exits leaving the output
	// pipe(s) (stdout, stderr) open. This happens because we set WaitDelay on
	// the command, which gives us two things:
	//
	// 1. The ability to ensure that a script exits (this is important for e.g.
	//    blocking login, and avoiding doing so indefinitely)
	// 2. Improved command cancellation on timeout
	ErrOutputPipesOpen = xerrors.New("script exited without closing output pipes")

	parser = cron.NewParser(cron.Second | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.DowOptional)
)

type ScriptLogger interface {
	Send(ctx context.Context, log ...agentsdk.Log) error
	Flush(context.Context) error
}

// Options are a set of options for the runner.
type Options struct {
	DataDirBase     string
	LogDir          string
	Logger          slog.Logger
	SSHServer       *agentssh.Server
	Filesystem      afero.Fs
	GetScriptLogger func(logSourceID uuid.UUID) ScriptLogger
}

// New creates a runner for the provided scripts.
func New(opts Options) *Runner {
	cronCtx, cronCtxCancel := context.WithCancel(context.Background())
	return &Runner{
		Options:       opts,
		cronCtx:       cronCtx,
		cronCtxCancel: cronCtxCancel,
		cron:          cron.New(cron.WithParser(parser)),
		closed:        make(chan struct{}),
		dataDir:       filepath.Join(opts.DataDirBase, "coder-script-data"),
		scriptsExecuted: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "agent",
			Subsystem: "scripts",
			Name:      "executed_total",
		}, []string{"success"}),
	}
}

type ScriptCompletedFunc func(context.Context, *proto.WorkspaceAgentScriptCompletedRequest) (*proto.WorkspaceAgentScriptCompletedResponse, error)

type Runner struct {
	Options

	cronCtx         context.Context
	cronCtxCancel   context.CancelFunc
	cmdCloseWait    sync.WaitGroup
	closed          chan struct{}
	closeMutex      sync.Mutex
	cron            *cron.Cron
	scripts         []codersdk.WorkspaceAgentScript
	dataDir         string
	scriptCompleted ScriptCompletedFunc

	// scriptsExecuted includes all scripts executed by the workspace agent. Agents
	// execute startup scripts, and scripts on a cron schedule. Both will increment
	// this counter.
	scriptsExecuted *prometheus.CounterVec

	initMutex   sync.Mutex
	initialized bool
}

// DataDir returns the directory where scripts data is stored.
func (r *Runner) DataDir() string {
	return r.dataDir
}

// ScriptBinDir returns the directory where scripts can store executable
// binaries.
func (r *Runner) ScriptBinDir() string {
	return filepath.Join(r.dataDir, "bin")
}

func (r *Runner) RegisterMetrics(reg prometheus.Registerer) {
	if reg == nil {
		// If no registry, do nothing.
		return
	}
	reg.MustRegister(r.scriptsExecuted)
}

// InitOption describes an option for the runner initialization.
type InitOption func(*Runner)

// Init initializes the runner with the provided scripts.
// It also schedules any scripts that have a schedule.
// This function must be called before Execute.
func (r *Runner) Init(scripts []codersdk.WorkspaceAgentScript, scriptCompleted ScriptCompletedFunc, opts ...InitOption) error {
	r.initMutex.Lock()
	defer r.initMutex.Unlock()
	if r.initialized {
		return xerrors.New("init: already initialized")
	}
	r.initialized = true
	r.scripts = scripts
	r.scriptCompleted = scriptCompleted
	for _, opt := range opts {
		opt(r)
	}
	r.Logger.Info(r.cronCtx, "initializing agent scripts", slog.F("script_count", len(scripts)), slog.F("log_dir", r.LogDir))

	err := r.Filesystem.MkdirAll(r.ScriptBinDir(), 0o700)
	if err != nil {
		return xerrors.Errorf("create script bin dir: %w", err)
	}

	for _, script := range r.scripts {
		if script.Cron == "" {
			continue
		}
		_, err := r.cron.AddFunc(script.Cron, func() {
			err := r.trackRun(r.cronCtx, script, ExecuteCronScripts)
			if err != nil {
				r.Logger.Warn(context.Background(), "run agent script on schedule", slog.Error(err))
			}
		})
		if err != nil {
			return xerrors.Errorf("add schedule: %w", err)
		}
	}
	return nil
}

// StartCron starts the cron scheduler.
// This is done async to allow for the caller to execute scripts prior.
func (r *Runner) StartCron() {
	// cron.Start() and cron.Stop() does not guarantee that the cron goroutine
	// has exited by the time the `cron.Stop()` context returns, so we need to
	// track it manually.
	err := r.trackCommandGoroutine(func() {
		// Since this is run async, in quick unit tests, it is possible the
		// Close() function gets called before we even start the cron.
		// In these cases, the Run() will never end.
		// So if we are closed, we just return, and skip the Run() entirely.
		select {
		case <-r.cronCtx.Done():
			// The cronCtx is canceled before cron.Close() happens. So if the ctx is
			// canceled, then Close() will be called, or it is about to be called.
			// So do nothing!
		default:
			r.cron.Run()
		}
	})
	if err != nil {
		r.Logger.Warn(context.Background(), "start cron failed", slog.Error(err))
	}
}

// ExecuteOption describes what scripts we want to execute.
type ExecuteOption int

// ExecuteOption enums.
const (
	ExecuteAllScripts ExecuteOption = iota
	ExecuteStartScripts
	ExecuteStopScripts
	ExecuteCronScripts
)

// Execute runs a set of scripts according to a filter.
func (r *Runner) Execute(ctx context.Context, option ExecuteOption) error {
	initErr := func() error {
		r.initMutex.Lock()
		defer r.initMutex.Unlock()
		if !r.initialized {
			return xerrors.New("execute: not initialized")
		}
		return nil
	}()
	if initErr != nil {
		return initErr
	}

	var eg errgroup.Group
	for _, script := range r.scripts {
		runScript := (option == ExecuteStartScripts && script.RunOnStart) ||
			(option == ExecuteStopScripts && script.RunOnStop) ||
			(option == ExecuteCronScripts && script.Cron != "") ||
			option == ExecuteAllScripts

		if !runScript {
			continue
		}

		eg.Go(func() error {
			err := r.trackRun(ctx, script, option)
			if err != nil {
				return xerrors.Errorf("run agent script %q: %w", script.LogSourceID, err)
			}
			return nil
		})
	}
	return eg.Wait()
}

// trackRun wraps "run" with metrics.
func (r *Runner) trackRun(ctx context.Context, script codersdk.WorkspaceAgentScript, option ExecuteOption) error {
	err := r.run(ctx, script, option)
	if err != nil {
		r.scriptsExecuted.WithLabelValues("false").Add(1)
	} else {
		r.scriptsExecuted.WithLabelValues("true").Add(1)
	}
	return err
}

// run executes the provided script with the timeout.
// If the timeout is exceeded, the process is sent an interrupt signal.
// If the process does not exit after a few seconds, it is forcefully killed.
// This function immediately returns after a timeout, and does not wait for the process to exit.
func (r *Runner) run(ctx context.Context, script codersdk.WorkspaceAgentScript, option ExecuteOption) error {
	logPath := script.LogPath
	if logPath == "" {
		logPath = fmt.Sprintf("coder-script-%s.log", script.LogSourceID)
	}
	if logPath[0] == '~' {
		// First we check the environment.
		homeDir, err := os.UserHomeDir()
		if err != nil {
			u, err := user.Current()
			if err != nil {
				return xerrors.Errorf("current user: %w", err)
			}
			homeDir = u.HomeDir
		}
		logPath = filepath.Join(homeDir, logPath[1:])
	}
	logPath = os.ExpandEnv(logPath)
	if !filepath.IsAbs(logPath) {
		logPath = filepath.Join(r.LogDir, logPath)
	}

	scriptDataDir := filepath.Join(r.DataDir(), script.LogSourceID.String())
	err := r.Filesystem.MkdirAll(scriptDataDir, 0o700)
	if err != nil {
		return xerrors.Errorf("%s script: create script temp dir: %w", scriptDataDir, err)
	}

	logger := r.Logger.With(
		slog.F("log_source_id", script.LogSourceID),
		slog.F("log_path", logPath),
		slog.F("script_data_dir", scriptDataDir),
	)
	logger.Info(ctx, "running agent script", slog.F("script", script.Script))

	fileWriter, err := r.Filesystem.OpenFile(logPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return xerrors.Errorf("open %s script log file: %w", logPath, err)
	}
	defer func() {
		err := fileWriter.Close()
		if err != nil {
			logger.Warn(ctx, fmt.Sprintf("close %s script log file", logPath), slog.Error(err))
		}
	}()

	var cmd *exec.Cmd
	cmdCtx := ctx
	if script.Timeout > 0 {
		var ctxCancel context.CancelFunc
		cmdCtx, ctxCancel = context.WithTimeout(ctx, script.Timeout)
		defer ctxCancel()
	}
	cmdPty, err := r.SSHServer.CreateCommand(cmdCtx, script.Script, nil, nil)
	if err != nil {
		return xerrors.Errorf("%s script: create command: %w", logPath, err)
	}
	cmd = cmdPty.AsExec()
	cmd.SysProcAttr = cmdSysProcAttr()
	cmd.WaitDelay = 10 * time.Second
	cmd.Cancel = cmdCancel(ctx, logger, cmd)

	// Expose env vars that can be used in the script for storing data
	// and binaries. In the future, we may want to expose more env vars
	// for the script to use, like CODER_SCRIPT_DATA_DIR for persistent
	// storage.
	cmd.Env = append(cmd.Env, "CODER_SCRIPT_DATA_DIR="+scriptDataDir)
	cmd.Env = append(cmd.Env, "CODER_SCRIPT_BIN_DIR="+r.ScriptBinDir())

	scriptLogger := r.GetScriptLogger(script.LogSourceID)
	// If ctx is canceled here (or in a writer below), we may be
	// discarding logs, but that's okay because we're shutting down
	// anyway. We could consider creating a new context here if we
	// want better control over flush during shutdown.
	defer func() {
		if err := scriptLogger.Flush(ctx); err != nil {
			logger.Warn(ctx, "flush startup logs failed", slog.Error(err))
		}
	}()

	infoW := agentsdk.LogsWriter(ctx, scriptLogger.Send, script.LogSourceID, codersdk.LogLevelInfo)
	defer infoW.Close()
	errW := agentsdk.LogsWriter(ctx, scriptLogger.Send, script.LogSourceID, codersdk.LogLevelError)
	defer errW.Close()
	cmd.Stdout = io.MultiWriter(fileWriter, infoW)
	cmd.Stderr = io.MultiWriter(fileWriter, errW)

	start := dbtime.Now()
	defer func() {
		end := dbtime.Now()
		execTime := end.Sub(start)
		exitCode := 0
		if err != nil {
			exitCode = 255 // Unknown status.
			var exitError *exec.ExitError
			if xerrors.As(err, &exitError) {
				exitCode = exitError.ExitCode()
			}
			logger.Warn(ctx, fmt.Sprintf("%s script failed", logPath), slog.F("execution_time", execTime), slog.F("exit_code", exitCode), slog.Error(err))
		} else {
			logger.Info(ctx, fmt.Sprintf("%s script completed", logPath), slog.F("execution_time", execTime), slog.F("exit_code", exitCode))
		}

		if r.scriptCompleted == nil {
			logger.Debug(ctx, "r.scriptCompleted unexpectedly nil")
			return
		}

		// We want to check this outside of the goroutine to avoid a race condition
		timedOut := errors.Is(err, ErrTimeout)
		pipesLeftOpen := errors.Is(err, ErrOutputPipesOpen)

		err = r.trackCommandGoroutine(func() {
			var stage proto.Timing_Stage
			switch option {
			case ExecuteStartScripts:
				stage = proto.Timing_START
			case ExecuteStopScripts:
				stage = proto.Timing_STOP
			case ExecuteCronScripts:
				stage = proto.Timing_CRON
			}

			var status proto.Timing_Status
			switch {
			case timedOut:
				status = proto.Timing_TIMED_OUT
			case pipesLeftOpen:
				status = proto.Timing_PIPES_LEFT_OPEN
			case exitCode != 0:
				status = proto.Timing_EXIT_FAILURE
			default:
				status = proto.Timing_OK
			}

			reportTimeout := 30 * time.Second
			reportCtx, cancel := context.WithTimeout(context.Background(), reportTimeout)
			defer cancel()

			_, err := r.scriptCompleted(reportCtx, &proto.WorkspaceAgentScriptCompletedRequest{
				Timing: &proto.Timing{
					ScriptId: script.ID[:],
					Start:    timestamppb.New(start),
					End:      timestamppb.New(end),
					ExitCode: int32(exitCode),
					Stage:    stage,
					Status:   status,
				},
			})
			if err != nil {
				logger.Error(ctx, fmt.Sprintf("reporting script completed: %s", err.Error()))
			}
		})
		if err != nil {
			logger.Error(ctx, fmt.Sprintf("reporting script completed: track command goroutine: %s", err.Error()))
		}
	}()

	err = cmd.Start()
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return ErrTimeout
		}
		return xerrors.Errorf("%s script: start command: %w", logPath, err)
	}

	cmdDone := make(chan error, 1)
	err = r.trackCommandGoroutine(func() {
		cmdDone <- cmd.Wait()
	})
	if err != nil {
		return xerrors.Errorf("%s script: track command goroutine: %w", logPath, err)
	}
	select {
	case <-cmdCtx.Done():
		// Wait for the command to drain!
		select {
		case <-cmdDone:
		case <-time.After(10 * time.Second):
		}
		err = cmdCtx.Err()
	case err = <-cmdDone:
	}
	switch {
	case errors.Is(err, exec.ErrWaitDelay):
		err = ErrOutputPipesOpen
		message := fmt.Sprintf("script exited successfully, but output pipes were not closed after %s", cmd.WaitDelay)
		details := fmt.Sprint(
			"This usually means a child process was started with references to stdout or stderr. As a result, this " +
				"process may now have been terminated. Consider redirecting the output or using a separate " +
				"\"coder_script\" for the process, see " +
				"https://docs.coder.buildworkforce.ai/templates/troubleshooting#startup-script-issues for more information.",
		)
		// Inform the user by propagating the message via log writers.
		_, _ = fmt.Fprintf(cmd.Stderr, "WARNING: %s. %s\n", message, details)
		// Also log to agent logs for ease of debugging.
		r.Logger.Warn(ctx, message, slog.F("details", details), slog.Error(err))

	case errors.Is(err, context.DeadlineExceeded):
		err = ErrTimeout
	}
	return err
}

func (r *Runner) Close() error {
	r.closeMutex.Lock()
	defer r.closeMutex.Unlock()
	if r.isClosed() {
		return nil
	}
	close(r.closed)
	// Must cancel the cron ctx BEFORE stopping the cron.
	r.cronCtxCancel()
	<-r.cron.Stop().Done()
	r.cmdCloseWait.Wait()
	return nil
}

func (r *Runner) trackCommandGoroutine(fn func()) error {
	r.closeMutex.Lock()
	defer r.closeMutex.Unlock()
	if r.isClosed() {
		return xerrors.New("track command goroutine: closed")
	}
	r.cmdCloseWait.Add(1)
	go func() {
		defer r.cmdCloseWait.Done()
		fn()
	}()
	return nil
}

func (r *Runner) isClosed() bool {
	select {
	case <-r.closed:
		return true
	default:
		return false
	}
}
