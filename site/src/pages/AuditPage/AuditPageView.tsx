import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableRow from "@mui/material/TableRow";
import type { AuditLog } from "api/typesGenerated";
import { ChooseOne, Cond } from "components/Conditionals/ChooseOne";
import { EmptyState } from "components/EmptyState/EmptyState";
import { Margins } from "components/Margins/Margins";
import {
	PageHeader,
	PageHeaderSubtitle,
	PageHeaderTitle,
} from "components/PageHeader/PageHeader";
import {
	PaginationContainer,
	type PaginationResult,
} from "components/PaginationWidget/PaginationContainer";
import { Paywall } from "components/Paywall/Paywall";
import { Stack } from "components/Stack/Stack";
import { TableLoader } from "components/TableLoader/TableLoader";
import { Timeline } from "components/Timeline/Timeline";
import type { ComponentProps, FC } from "react";
import { docs } from "utils/docs";
import { AuditFilter } from "./AuditFilter";
import { AuditHelpTooltip } from "./AuditHelpTooltip";
import { AuditLogRow } from "./AuditLogRow/AuditLogRow";

const Language = {
	title: "Audit",
	subtitle: "View events in your audit log.",
};

interface AuditPageViewProps {
	auditLogs?: readonly AuditLog[];
	isNonInitialPage: boolean;
	isAuditLogVisible: boolean;
	error?: unknown;
	filterProps: ComponentProps<typeof AuditFilter>;
	auditsQuery: PaginationResult;
	showOrgDetails: boolean;
}

export const AuditPageView: FC<AuditPageViewProps> = ({
	auditLogs,
	isNonInitialPage,
	isAuditLogVisible,
	error,
	filterProps,
	auditsQuery: paginationResult,
	showOrgDetails,
}) => {
	const isLoading =
		(auditLogs === undefined || paginationResult.totalRecords === undefined) &&
		!error;

	const isEmpty = !isLoading && auditLogs?.length === 0;

	return (
		<Margins>
			<PageHeader>
				<PageHeaderTitle>
					<Stack direction="row" spacing={1} alignItems="center">
						<span>{Language.title}</span>
						<AuditHelpTooltip />
					</Stack>
				</PageHeaderTitle>
				<PageHeaderSubtitle>{Language.subtitle}</PageHeaderSubtitle>
			</PageHeader>

			<ChooseOne>
				<Cond condition={isAuditLogVisible}>
					<AuditFilter {...filterProps} />

					<PaginationContainer
						query={paginationResult}
						paginationUnitLabel="logs"
					>
						<TableContainer>
							<Table>
								<TableBody>
									<ChooseOne>
										{/* Error condition should just show an empty table. */}
										<Cond condition={Boolean(error)}>
											<TableRow>
												<TableCell colSpan={999}>
													<EmptyState message="An error occurred while loading audit logs" />
												</TableCell>
											</TableRow>
										</Cond>

										<Cond condition={isLoading}>
											<TableLoader />
										</Cond>

										<Cond condition={isEmpty}>
											<ChooseOne>
												<Cond condition={isNonInitialPage}>
													<TableRow>
														<TableCell colSpan={999}>
															<EmptyState message="No audit logs available on this page" />
														</TableCell>
													</TableRow>
												</Cond>

												<Cond>
													<TableRow>
														<TableCell colSpan={999}>
															<EmptyState message="No audit logs available" />
														</TableCell>
													</TableRow>
												</Cond>
											</ChooseOne>
										</Cond>

										<Cond>
											{auditLogs && (
												<Timeline
													items={auditLogs}
													getDate={(log) => new Date(log.time)}
													row={(log) => (
														<AuditLogRow
															key={log.id}
															auditLog={log}
															showOrgDetails={showOrgDetails}
														/>
													)}
												/>
											)}
										</Cond>
									</ChooseOne>
								</TableBody>
							</Table>
						</TableContainer>
					</PaginationContainer>
				</Cond>

				<Cond>
					<Paywall
						message="Audit logs"
						description="Audit logs allow you to monitor user operations on your deployment."
						documentationLink={docs("/admin/security/audit-logs")}
					/>
				</Cond>
			</ChooseOne>
		</Margins>
	);
};
