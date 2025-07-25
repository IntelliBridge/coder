import type { Interpolation, Theme } from "@emotion/react";
import type { FC, PropsWithChildren } from "react";

export const SignInLayout: FC<PropsWithChildren> = ({ children }) => {
	return (
		<div css={styles.container}>
			<div css={styles.content}>
				<div css={styles.signIn}>{children}</div>
				<div css={styles.copyright}>
					{"\u00a9"} {new Date().getFullYear()} Workforce.
				</div>
			</div>
		</div>
	);
};

const styles = {
	container: {
		flex: 1,
		// Fallback to 100vh
		height: ["100vh", "-webkit-fill-available"],
		display: "flex",
		justifyContent: "center",
		alignItems: "center",
	},

	content: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
	},

	signIn: {
		maxWidth: 385,
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
	},

	copyright: (theme) => ({
		fontSize: 12,
		color: theme.palette.text.secondary,
		marginTop: 24,
	}),
} satisfies Record<string, Interpolation<Theme>>;
