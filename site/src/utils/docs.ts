import { getStaticBuildInfo } from "./buildInfo";

function defaultDocsUrl(): string {
	// Use environment variable CODER_DOCS_URL if set, otherwise fall back to default
	const envDocsUrl = process.env.CODER_DOCS_URL;
	if (envDocsUrl) {
		return envDocsUrl;
	}
	
	const docsUrl = "https://docs.coder.buildworkforce.ai";
	// If we can get the specific version, we want to include that in default docs URL.
	let version = getStaticBuildInfo()?.version;
	if (!version) {
		return docsUrl;
	}

	// Strip the postfix version info that's not part of the link.
	const i = version?.match(/[+-]/)?.index ?? -1;
	if (i >= 0) {
		version = version.slice(0, i);
	}
	return `${docsUrl}/@${version}`;
}

// Add cache to avoid DOM reading all the time
let CACHED_DOCS_URL: string | undefined;

export const docs = (path: string) => {
	return `${getBaseDocsURL()}${path}`;
};

const getBaseDocsURL = () => {
	if (!CACHED_DOCS_URL) {
		const docsUrl = document
			.querySelector<HTMLMetaElement>('meta[property="docs-url"]')
			?.getAttribute("content");

		const isValidDocsURL = docsUrl && isURL(docsUrl);
		CACHED_DOCS_URL = isValidDocsURL ? docsUrl : defaultDocsUrl();
	}
	return CACHED_DOCS_URL;
};

const isURL = (value: string) => {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
};
