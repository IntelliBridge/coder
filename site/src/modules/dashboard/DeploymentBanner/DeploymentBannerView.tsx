import type { CSSInterpolation } from "@emotion/css/dist/declarations/src/create-instance";
import { type Interpolation, type Theme, css, useTheme } from "@emotion/react";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Tooltip from "@mui/material/Tooltip";
import type {
	DeploymentStats,
	HealthcheckReport,
	WorkspaceStatus,
} from "api/typesGenerated";
import { HelpTooltipTitle } from "components/HelpTooltip/HelpTooltip";
import { JetBrainsIcon } from "components/Icons/JetBrainsIcon";
import { RocketIcon } from "components/Icons/RocketIcon";
import { TerminalIcon } from "components/Icons/TerminalIcon";
import { VSCodeIcon } from "components/Icons/VSCodeIcon";
import { Stack } from "components/Stack/Stack";
import dayjs from "dayjs";
import { type ClassName, useClassName } from "hooks/useClassName";
import { CloudDownloadIcon } from "lucide-react";
import { CloudUploadIcon } from "lucide-react";
import { GitCompareArrowsIcon } from "lucide-react";
import { GaugeIcon } from "lucide-react";
import { AppWindowIcon } from "lucide-react";
import { RotateCwIcon, WrenchIcon } from "lucide-react";
import { CircleAlertIcon } from "lucide-react";
import prettyBytes from "pretty-bytes";
import {
	type FC,
	type PropsWithChildren,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Link as RouterLink } from "react-router-dom";
import { MONOSPACE_FONT_FAMILY } from "theme/constants";
import colors from "theme/tailwindColors";
import { getDisplayWorkspaceStatus } from "utils/workspace";

const bannerHeight = 36;

interface DeploymentBannerViewProps {
	health?: HealthcheckReport;
	stats?: DeploymentStats;
	fetchStats?: () => void;
}

export const DeploymentBannerView: FC<DeploymentBannerViewProps> = ({
	health,
	stats,
	fetchStats,
}) => {
	const theme = useTheme();
	const summaryTooltip = useClassName(classNames.summaryTooltip, []);

	const aggregatedMinutes = useMemo(() => {
		if (!stats) {
			return;
		}
		return dayjs(stats.collected_at).diff(stats.aggregated_from, "minutes");
	}, [stats]);

	const [timeUntilRefresh, setTimeUntilRefresh] = useState(0);
	useEffect(() => {
		if (!stats || !fetchStats) {
			return;
		}

		let timeUntilRefresh = dayjs(stats.next_update_at).diff(
			stats.collected_at,
			"seconds",
		);
		setTimeUntilRefresh(timeUntilRefresh);
		let canceled = false;
		const loop = () => {
			if (canceled) {
				return undefined;
			}
			setTimeUntilRefresh(timeUntilRefresh--);
			if (timeUntilRefresh > 0) {
				return window.setTimeout(loop, 1000);
			}
			fetchStats();
		};
		const timeout = setTimeout(loop, 1000);
		return () => {
			canceled = true;
			clearTimeout(timeout);
		};
	}, [fetchStats, stats]);

	// biome-ignore lint/correctness/useExhaustiveDependencies(timeUntilRefresh): periodic refresh
	const lastAggregated = useMemo(() => {
		if (!stats) {
			return;
		}
		if (!fetchStats) {
			// Storybook!
			return "just now";
		}
		return dayjs().to(dayjs(stats.collected_at));
	}, [timeUntilRefresh, stats, fetchStats]);

	const healthErrors = health ? getHealthErrors(health) : [];
	const displayLatency = stats?.workspaces.connection_latency_ms.P50 || -1;

	return (
		<div
			css={{
				position: "sticky",
				lineHeight: 1,
				height: bannerHeight,
				bottom: 0,
				zIndex: 1,
				paddingRight: 16,
				backgroundColor: theme.palette.background.paper,
				display: "flex",
				alignItems: "center",
				fontFamily: MONOSPACE_FONT_FAMILY,
				fontSize: 12,
				gap: 32,
				borderTop: `1px solid ${theme.palette.divider}`,
				overflowX: "auto",
				whiteSpace: "nowrap",
			}}
		>
			<Tooltip
				classes={{ tooltip: summaryTooltip }}
				title={
					healthErrors.length > 0 ? (
						<>
							<HelpTooltipTitle>
								We have detected problems with your Workbench deployment.
							</HelpTooltipTitle>
							<Stack spacing={1}>
								{healthErrors.map((error) => (
									<HealthIssue key={error}>{error}</HealthIssue>
								))}
							</Stack>
						</>
					) : (
						<>Status of your Workbench deployment. Only visible for admins!</>
					)
				}
				open={process.env.STORYBOOK === "true" ? true : undefined}
				css={{ marginRight: -16 }}
			>
				{healthErrors.length > 0 ? (
					<Link
						component={RouterLink}
						to="/health"
						css={[styles.statusBadge, styles.unhealthy]}
					>
						<CircleAlertIcon className="size-icon-sm" />
					</Link>
				) : (
					<div css={styles.statusBadge}>
						<RocketIcon />
					</div>
				)}
			</Tooltip>

			<div css={styles.group}>
				<div css={styles.category}>Workspaces</div>
				<div css={styles.values}>
					<WorkspaceBuildValue
						status="pending"
						count={stats?.workspaces.pending}
					/>
					<ValueSeparator />
					<WorkspaceBuildValue
						status="starting"
						count={stats?.workspaces.building}
					/>
					<ValueSeparator />
					<WorkspaceBuildValue
						status="running"
						count={stats?.workspaces.running}
					/>
					<ValueSeparator />
					<WorkspaceBuildValue
						status="stopped"
						count={stats?.workspaces.stopped}
					/>
					<ValueSeparator />
					<WorkspaceBuildValue
						status="failed"
						count={stats?.workspaces.failed}
					/>
				</div>
			</div>

			<div css={styles.group}>
				<Tooltip title={`Activity in the last ~${aggregatedMinutes} minutes`}>
					<div css={styles.category}>Transmission</div>
				</Tooltip>

				<div css={styles.values}>
					<Tooltip title="Data sent to workspaces">
						<div css={styles.value}>
							<CloudDownloadIcon className="size-icon-xs" />
							{stats ? prettyBytes(stats.workspaces.rx_bytes) : "-"}
						</div>
					</Tooltip>
					<ValueSeparator />
					<Tooltip title="Data sent from workspaces">
						<div css={styles.value}>
							<CloudUploadIcon className="size-icon-xs" />
							{stats ? prettyBytes(stats.workspaces.tx_bytes) : "-"}
						</div>
					</Tooltip>
					<ValueSeparator />
					<Tooltip
						title={
							displayLatency < 0
								? "No recent workspace connections have been made"
								: "The average latency of user connections to workspaces"
						}
					>
						<div css={styles.value}>
							<GaugeIcon className="size-icon-xs" />
							{displayLatency > 0 ? `${displayLatency?.toFixed(2)} ms` : "-"}
						</div>
					</Tooltip>
				</div>
			</div>

			<div css={styles.group}>
				<div css={styles.category}>Active Connections</div>

				<div css={styles.values}>
					<Tooltip title="VS Code Editors with the Coder Remote Extension">
						<div css={styles.value}>
							<VSCodeIcon
								css={css`
                  & * {
                    fill: currentColor;
                  }
                `}
							/>
							{typeof stats?.session_count.vscode === "undefined"
								? "-"
								: stats?.session_count.vscode}
						</div>
					</Tooltip>
					<ValueSeparator />
					<Tooltip title="JetBrains Editors">
						<div css={styles.value}>
							<JetBrainsIcon
								css={css`
                  & * {
                    fill: currentColor;
                  }
                `}
							/>
							{typeof stats?.session_count.jetbrains === "undefined"
								? "-"
								: stats?.session_count.jetbrains}
						</div>
					</Tooltip>
					<ValueSeparator />
					<Tooltip title="SSH Sessions">
						<div css={styles.value}>
							<TerminalIcon />
							{typeof stats?.session_count.ssh === "undefined"
								? "-"
								: stats?.session_count.ssh}
						</div>
					</Tooltip>
					<ValueSeparator />
					<Tooltip title="Web Terminal Sessions">
						<div css={styles.value}>
							<AppWindowIcon className="size-icon-xs" />
							{typeof stats?.session_count.reconnecting_pty === "undefined"
								? "-"
								: stats?.session_count.reconnecting_pty}
						</div>
					</Tooltip>
				</div>
			</div>

			<div
				css={{
					color: theme.palette.text.primary,
					marginLeft: "auto",
					display: "flex",
					alignItems: "center",
					gap: 16,
				}}
			>
				<Tooltip title="The last time stats were aggregated. Workspaces report statistics periodically, so it may take a bit for these to update!">
					<div css={styles.value}>
						<GitCompareArrowsIcon className="size-icon-xs" />
						{lastAggregated}
					</div>
				</Tooltip>

				<Tooltip title="A countdown until stats are fetched again. Click to refresh!">
					<Button
						css={[
							styles.value,
							css`
                margin: 0;
                padding: 0 8px;
                height: unset;
                min-height: unset;
                font-size: unset;
                color: unset;
                border: 0;
                min-width: unset;
                font-family: inherit;

                & svg {
                  margin-right: 4px;
                }
              `,
						]}
						onClick={() => {
							if (fetchStats) {
								fetchStats();
							}
						}}
						variant="text"
					>
						<RotateCwIcon className="size-icon-xs" />
						{timeUntilRefresh}s
					</Button>
				</Tooltip>
			</div>
		</div>
	);
};

interface WorkspaceBuildValueProps {
	status: WorkspaceStatus;
	count?: number;
}

const WorkspaceBuildValue: FC<WorkspaceBuildValueProps> = ({
	status,
	count,
}) => {
	const displayStatus = getDisplayWorkspaceStatus(status);
	let statusText = displayStatus.text;
	let icon = displayStatus.icon;
	if (status === "starting") {
		icon = <WrenchIcon className="size-icon-xs" />;
		statusText = "Building";
	}

	return (
		<Tooltip title={`${statusText} Workspaces`}>
			<Link
				component={RouterLink}
				to={`/workspaces?filter=${encodeURIComponent(`status:${status}`)}`}
			>
				<div css={styles.value}>
					{icon}
					{typeof count === "undefined" ? "-" : count}
				</div>
			</Link>
		</Tooltip>
	);
};

const ValueSeparator: FC = () => {
	return <div css={styles.separator}>/</div>;
};

const HealthIssue: FC<PropsWithChildren> = ({ children }) => {
	const theme = useTheme();

	return (
		<Stack direction="row" spacing={1} alignItems="center">
			<CircleAlertIcon
				className="size-icon-sm"
				css={{ color: theme.roles.error.outline }}
			/>
			{children}
		</Stack>
	);
};

const getHealthErrors = (health: HealthcheckReport) => {
	const warnings: string[] = [];
	const sections = [
		"access_url",
		"database",
		"derp",
		"websocket",
		"workspace_proxy",
	] as const;
	const messages: Record<(typeof sections)[number], string> = {
		access_url: "Your access URL may be configured incorrectly.",
		database: "Your database is unhealthy.",
		derp: "We're noticing DERP proxy issues.",
		websocket: "We're noticing websocket issues.",
		workspace_proxy: "We're noticing workspace proxy issues.",
	} as const;

	for (const section of sections) {
		if (health[section].severity === "error" && !health[section].dismissed) {
			warnings.push(messages[section]);
		}
	}

	return warnings;
};

const classNames = {
	summaryTooltip: (css, theme) => css`
    ${theme.typography.body2 as CSSInterpolation}

    margin: 0 0 4px 12px;
    width: 400px;
    padding: 16px;
    color: ${theme.palette.text.primary};
    background-color: ${theme.palette.background.paper};
    border: 1px solid ${theme.palette.divider};
    pointer-events: none;
  `,
} satisfies Record<string, ClassName>;

const styles = {
	statusBadge: (theme) => css`
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 12px;
    height: 100%;
    color: ${theme.experimental.l1.text};

    & svg {
      width: 16px;
      height: 16px;
    }
  `,
	unhealthy: {
		backgroundColor: colors.red[700],
	},
	group: css`
    display: flex;
    align-items: center;
  `,
	category: (theme) => ({
		marginRight: 16,
		color: theme.palette.text.primary,
	}),
	values: (theme) => ({
		display: "flex",
		gap: 8,
		color: theme.palette.text.secondary,
	}),
	value: css`
    display: flex;
    align-items: center;
    gap: 4px;

    & svg {
      width: 12px;
      height: 12px;
    }
  `,
	separator: (theme) => ({
		color: theme.palette.text.disabled,
	}),
} satisfies Record<string, Interpolation<Theme>>;
