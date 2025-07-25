import { humanDuration } from "utils/time";

const hours = (h: number) => (h === 1 ? "hour" : "hours");

export const DefaultTTLHelperText = (props: { ttl?: number }) => {
	const { ttl = 0 } = props;

	// Error will show once field is considered touched
	if (ttl < 0) {
		return null;
	}

	if (ttl === 0) {
		return <span>Workspaces will run until stopped manually.</span>;
	}

	return (
		<span>
			Workspaces will default to stopping after {ttl} {hours(ttl)} after being
			started.
		</span>
	);
};

export const ActivityBumpHelperText = (props: { bump?: number }) => {
	const { bump = 0 } = props;

	// Error will show once field is considered touched
	if (bump < 0) {
		return null;
	}

	if (bump === 0) {
		return (
			<span>
				Workspaces will not have their stop time automatically extended based on
				user activity. Users can still manually delay the stop time.
			</span>
		);
	}

	return (
		<span>
			Workspaces will be automatically bumped by {bump} {hours(bump)} when user
			activity is detected.
		</span>
	);
};

export const FailureTTLHelperText = (props: { ttl?: number }) => {
	const { ttl = 0 } = props;

	// Error will show once field is considered touched
	if (ttl < 0) {
		return null;
	}

	if (ttl === 0) {
		return <span>Workbench will not automatically stop failed workspaces.</span>;
	}

	return (
		<span>
			Workbench will attempt to stop failed workspaces after {humanDuration(ttl)}.
		</span>
	);
};

export const DormancyTTLHelperText = (props: { ttl?: number }) => {
	const { ttl = 0 } = props;

	// Error will show once field is considered touched
	if (ttl < 0) {
		return null;
	}

	if (ttl === 0) {
		return <span>Workbench will not mark workspaces as dormant.</span>;
	}

	return (
		<span>
			Workbench will mark workspaces as dormant after {humanDuration(ttl)} without
			user connections.
		</span>
	);
};

export const DormancyAutoDeletionTTLHelperText = (props: { ttl?: number }) => {
	const { ttl = 0 } = props;

	// Error will show once field is considered touched
	if (ttl < 0) {
		return null;
	}

	if (ttl === 0) {
		return <span>Workbench will not automatically delete dormant workspaces.</span>;
	}

	return (
		<span>
			Workbench will automatically delete dormant workspaces after{" "}
			{humanDuration(ttl)}.
		</span>
	);
};
