import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import { API } from "api/api";
import type { Template, TemplateVersionParameter } from "api/typesGenerated";
import { FormSection, VerticalForm } from "components/Form/Form";
import { Loader } from "components/Loader/Loader";
import { RichParameterInput } from "components/RichParameterInput/RichParameterInput";
import { useClipboard } from "hooks/useClipboard";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useTemplateLayoutContext } from "pages/TemplatePage/TemplateLayout";
import { type FC, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useQuery } from "react-query";
import { pageTitle } from "utils/page";
import { getInitialRichParameterValues } from "utils/richParameters";
import { paramsUsedToCreateWorkspace } from "utils/workspace";

type ButtonValues = Record<string, string>;

const TemplateEmbedPage: FC = () => {
	const { template } = useTemplateLayoutContext();
	const { data: templateParameters } = useQuery({
		queryKey: ["template", template.id, "embed"],
		queryFn: () =>
			API.getTemplateVersionRichParameters(template.active_version_id),
	});

	return (
		<>
			<Helmet>
				<title>{pageTitle(template.name)}</title>
			</Helmet>
			<TemplateEmbedPageView
				template={template}
				templateParameters={templateParameters?.filter(
					paramsUsedToCreateWorkspace,
				)}
			/>
		</>
	);
};

interface TemplateEmbedPageViewProps {
	template: Template;
	templateParameters?: TemplateVersionParameter[];
}

function getClipboardCopyContent(
	templateName: string,
	organization: string,
	buttonValues: ButtonValues | undefined,
): string {
	const deploymentUrl = `${window.location.protocol}//${window.location.host}`;
	const createWorkspaceUrl = `${deploymentUrl}/templates/${organization}/${templateName}/workspace`;
	const createWorkspaceParams = new URLSearchParams(buttonValues);
	const buttonUrl = `${createWorkspaceUrl}?${createWorkspaceParams.toString()}`;

	return `[![Open in Workbench](${deploymentUrl}/open-in-coder.svg)](${buttonUrl})`;
}

export const TemplateEmbedPageView: FC<TemplateEmbedPageViewProps> = ({
	template,
	templateParameters,
}) => {
	const [buttonValues, setButtonValues] = useState<ButtonValues | undefined>();
	const clipboard = useClipboard({
		textToCopy: getClipboardCopyContent(
			template.name,
			template.organization_name,
			buttonValues,
		),
	});

	// template parameters is async so we need to initialize the values after it
	// is loaded
	useEffect(() => {
		if (templateParameters && !buttonValues) {
			const buttonValues: ButtonValues = {
				mode: "manual",
			};
			for (const parameter of getInitialRichParameterValues(
				templateParameters,
			)) {
				buttonValues[`param.${parameter.name}`] = parameter.value;
			}
			setButtonValues(buttonValues);
		}
	}, [buttonValues, templateParameters]);

	return (
		<>
			<Helmet>
				<title>{pageTitle(template.name)}</title>
			</Helmet>
			{!buttonValues || !templateParameters ? (
				<Loader />
			) : (
				<div className="flex items-start gap-12">
					<div className="max-w-3xl">
						<VerticalForm>
							<FormSection
								title="Creation mode"
								description="By changing the mode to automatic, when the user clicks the button, the workspace will be created automatically instead of showing a form to the user."
							>
								<RadioGroup
									defaultValue={buttonValues.mode}
									onChange={(_, v) => {
										setButtonValues((buttonValues) => ({
											...buttonValues,
											mode: v,
										}));
									}}
								>
									<FormControlLabel
										value="manual"
										control={<Radio size="small" />}
										label="Manual"
									/>
									<FormControlLabel
										value="auto"
										control={<Radio size="small" />}
										label="Automatic"
									/>
								</RadioGroup>
							</FormSection>

							{templateParameters.length > 0 && (
								<div
									css={{ display: "flex", flexDirection: "column", gap: 36 }}
								>
									{templateParameters.map((parameter) => {
										const parameterValue =
											buttonValues[`param.${parameter.name}`] ?? "";

										return (
											<RichParameterInput
												value={parameterValue}
												onChange={async (value) => {
													setButtonValues((buttonValues) => ({
														...buttonValues,
														[`param.${parameter.name}`]: value,
													}));
												}}
												key={parameter.name}
												parameter={parameter}
											/>
										);
									})}
								</div>
							)}
						</VerticalForm>
					</div>

					<div
						css={(theme) => ({
							// 80px for padding, 36px is for the status bar. We want to use `vh`
							// so that it will be relative to the screen and not the parent layout.
							height: "calc(100vh - (80px + 36px))",
							top: 40,
							position: "sticky",
							display: "flex",
							padding: 64,
							flex: 1,
							alignItems: "center",
							justifyContent: "center",
							borderRadius: 8,
							backgroundColor: theme.palette.background.paper,
							border: `1px solid ${theme.palette.divider}`,
						})}
					>
						<img src="/open-in-coder.svg" alt="Open in Workbench button" />
						<div
							css={{
								padding: "48px 16px",
								position: "absolute",
								bottom: 0,
								left: 0,
								display: "flex",
								justifyContent: "center",
								width: "100%",
							}}
						>
							<Button
								css={{ borderRadius: 999 }}
								startIcon={
									clipboard.showCopiedSuccess ? (
										<CheckIcon className="size-icon-sm" />
									) : (
										<CopyIcon className="size-icon-sm" />
									)
								}
								variant="contained"
								onClick={clipboard.copyToClipboard}
								disabled={clipboard.showCopiedSuccess}
							>
								Copy button code
							</Button>
						</div>
					</div>
				</div>
			)}
		</>
	);
};

export default TemplateEmbedPage;
