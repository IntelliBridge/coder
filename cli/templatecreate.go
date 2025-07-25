package cli

import (
	"fmt"
	"time"
	"unicode/utf8"

	"golang.org/x/xerrors"

	"github.com/coder/pretty"
	"github.com/coder/serpent"

	"github.com/coder/coder/v2/cli/cliui"
	"github.com/coder/coder/v2/coderd/util/ptr"
	"github.com/coder/coder/v2/codersdk"
)

func (r *RootCmd) templateCreate() *serpent.Command {
	var (
		provisioner          string
		provisionerTags      []string
		variablesFile        string
		commandLineVariables []string
		disableEveryone      bool
		requireActiveVersion bool

		defaultTTL           time.Duration
		failureTTL           time.Duration
		dormancyThreshold    time.Duration
		dormancyAutoDeletion time.Duration

		uploadFlags templateUploadFlags
		orgContext  = NewOrganizationContext()
	)
	client := new(codersdk.Client)
	cmd := &serpent.Command{
		Use:   "create [name]",
		Short: "DEPRECATED: Create a template from the current directory or as specified by flag",
		Middleware: serpent.Chain(
			serpent.RequireRangeArgs(0, 1),
			cliui.DeprecationWarning(
				"Use `coder templates push` command for creating and updating templates. \n"+
					"Use `coder templates edit` command for editing template settings. ",
			),
			r.InitClient(client),
		),
		Handler: func(inv *serpent.Invocation) error {
			// isTemplateSchedulingOptionsSet := failureTTL != 0 || dormancyThreshold != 0 || dormancyAutoDeletion != 0

			// Check entitlements for enterprise features
			// if entitlements, err := client.Entitlements(inv.Context()); err == nil {
			// 	if isTemplateSchedulingOptionsSet {
			// 		if !entitlements.Features[codersdk.FeatureAdvancedTemplateScheduling].Enabled {
			// 			return xerrors.Errorf("your license is not entitled to use advanced template scheduling, so you cannot set --failure-ttl, or --inactivity-ttl")
			// 		}
			// 	}

			// 	if requireActiveVersion {
			// 		if !entitlements.Features[codersdk.FeatureAccessControl].Enabled {
			// 			return xerrors.Errorf("your license is not entitled to use access control, so you cannot set --require-active-version")
			// 		}
			// 	}
			// }

			organization, err := orgContext.Selected(inv, client)
			if err != nil {
				return err
			}

			templateName, err := uploadFlags.templateName(inv)
			if err != nil {
				return err
			}

			if utf8.RuneCountInString(templateName) > 32 {
				return xerrors.Errorf("Template name must be no more than 32 characters")
			}

			_, err = client.TemplateByName(inv.Context(), organization.ID, templateName)
			if err == nil {
				return xerrors.Errorf("A template already exists named %q!", templateName)
			}

			err = uploadFlags.checkForLockfile(inv)
			if err != nil {
				return xerrors.Errorf("check for lockfile: %w", err)
			}

			message := uploadFlags.templateMessage(inv)

			var varsFiles []string
			if !uploadFlags.stdin(inv) {
				varsFiles, err = codersdk.DiscoverVarsFiles(uploadFlags.directory)
				if err != nil {
					return err
				}

				if len(varsFiles) > 0 {
					_, _ = fmt.Fprintln(inv.Stdout, "Auto-discovered Terraform tfvars files. Make sure to review and clean up any unused files.")
				}
			}

			// Confirm upload of the directory.
			resp, err := uploadFlags.upload(inv, client)
			if err != nil {
				return err
			}

			tags, err := ParseProvisionerTags(provisionerTags)
			if err != nil {
				return err
			}

			userVariableValues, err := codersdk.ParseUserVariableValues(
				varsFiles,
				variablesFile,
				commandLineVariables)
			if err != nil {
				return err
			}

			job, err := createValidTemplateVersion(inv, createValidTemplateVersionArgs{
				Message:            message,
				Client:             client,
				Organization:       organization,
				Provisioner:        codersdk.ProvisionerType(provisioner),
				FileID:             resp.ID,
				ProvisionerTags:    tags,
				UserVariableValues: userVariableValues,
			})
			if err != nil {
				return err
			}

			if !uploadFlags.stdin(inv) {
				_, err = cliui.Prompt(inv, cliui.PromptOptions{
					Text:      "Confirm create?",
					IsConfirm: true,
				})
				if err != nil {
					return err
				}
			}

			createReq := codersdk.CreateTemplateRequest{
				Name:                           templateName,
				VersionID:                      job.ID,
				DefaultTTLMillis:               ptr.Ref(defaultTTL.Milliseconds()),
				FailureTTLMillis:               ptr.Ref(failureTTL.Milliseconds()),
				TimeTilDormantMillis:           ptr.Ref(dormancyThreshold.Milliseconds()),
				TimeTilDormantAutoDeleteMillis: ptr.Ref(dormancyAutoDeletion.Milliseconds()),
				DisableEveryoneGroupAccess:     disableEveryone,
				RequireActiveVersion:           requireActiveVersion,
			}

			template, err := client.CreateTemplate(inv.Context(), organization.ID, createReq)
			if err != nil {
				return err
			}

			_, _ = fmt.Fprintln(inv.Stdout, "\n"+pretty.Sprint(cliui.DefaultStyles.Wrap,
				"The "+pretty.Sprint(
					cliui.DefaultStyles.Keyword, templateName)+" template has been created at "+
					pretty.Sprint(cliui.DefaultStyles.DateTimeStamp, time.Now().Format(time.Stamp))+"! "+
					"Developers can provision a workspace with this template using:")+"\n")

			_, _ = fmt.Fprintln(inv.Stdout, "  "+pretty.Sprint(cliui.DefaultStyles.Code, fmt.Sprintf("coder create --template=%q --org=%q [workspace name]", templateName, template.OrganizationName)))
			_, _ = fmt.Fprintln(inv.Stdout)

			return nil
		},
	}
	cmd.Options = serpent.OptionSet{
		{
			Flag: "private",
			Description: "Disable the default behavior of granting template access to the 'everyone' group. " +
				"The template permissions must be updated to allow non-admin users to use this template.",
			Value: serpent.BoolOf(&disableEveryone),
		},
		{
			Flag:        "variables-file",
			Description: "Specify a file path with values for Terraform-managed variables.",
			Value:       serpent.StringOf(&variablesFile),
		},
		{
			Flag:        "variable",
			Description: "Specify a set of values for Terraform-managed variables.",
			Value:       serpent.StringArrayOf(&commandLineVariables),
		},
		{
			Flag:        "var",
			Description: "Alias of --variable.",
			Value:       serpent.StringArrayOf(&commandLineVariables),
		},
		{
			Flag:        "provisioner-tag",
			Description: "Specify a set of tags to target provisioner daemons.",
			Value:       serpent.StringArrayOf(&provisionerTags),
		},
		{
			Flag:        "default-ttl",
			Description: "Specify a default TTL for workspaces created from this template. It is the default time before shutdown - workspaces created from this template default to this value. Maps to \"Default autostop\" in the UI.",
			Default:     "24h",
			Value:       serpent.DurationOf(&defaultTTL),
		},
		{
			Flag:        "failure-ttl",
			Description: "Specify a failure TTL for workspaces created from this template. It is the amount of time after a failed \"start\" build before coder automatically schedules a \"stop\" build to cleanup. Default is 0h (off). Maps to \"Failure cleanup\" in the UI.",
			Default:     "0h",
			Value:       serpent.DurationOf(&failureTTL),
		},
		{
			Flag:        "dormancy-threshold",
			Description: "Specify a duration workspaces may be inactive prior to being moved to the dormant state. Default is 0h (off). Maps to \"Dormancy threshold\" in the UI.",
			Default:     "0h",
			Value:       serpent.DurationOf(&dormancyThreshold),
		},
		{
			Flag:        "dormancy-auto-deletion",
			Description: "Specify a duration workspaces may be in the dormant state prior to being deleted. Default is 0h (off). Maps to \"Dormancy Auto-Deletion\" in the UI.",
			Default:     "0h",
			Value:       serpent.DurationOf(&dormancyAutoDeletion),
		},
		{
			Flag:        "test.provisioner",
			Description: "Customize the provisioner backend.",
			Default:     "terraform",
			Value:       serpent.StringOf(&provisioner),
			Hidden:      true,
		},
		{
			Flag:        "require-active-version",
			Description: "Requires workspace builds to use the active template version. This setting does not apply to template admins. See the documentation on template management for more details.",
			Value:       serpent.BoolOf(&requireActiveVersion),
			Default:     "false",
		},

		cliui.SkipPromptOption(),
	}
	orgContext.AttachOptions(cmd)
	cmd.Options = append(cmd.Options, uploadFlags.options()...)
	return cmd
}
