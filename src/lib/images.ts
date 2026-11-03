/**
 * @fileoverview Isomorphic image library model shared by the `/images` management page, the
 * `BlockInspector` image picker, widget components and server persistence.
 *
 * Each {@link ManagedImage} has a human-readable `name`, a `url` (either a local path served from
 * `static/images/…` or an external/data image address) and a predefined `category` (see
 * {@link imageCategories}).
 *
 * The library is prepopulated with the 50 icons of the SVG Repo "Isometric 3D Interface Icons"
 * collection (`https://www.svgrepo.com/collection/isometric-3d-interface-icons/`) stored on the
 * server under `static/images/isometric/`, plus the existing SVG icons in `static/`.
 *
 * Interacts with:
 * - `server/project-store.ts` – database CRUD and idempotent prepopulation of `images`.
 * - `server/image-files.ts` – writing and deleting SVG/raster files in `static/images/`.
 * - `routes/images/` – the Images management UI and `/images/api` endpoint.
 * - `components/BlockInspector.svelte` – the visual image picker for image-capable widgets.
 */

/** Predefined category identifiers for managed images. */
export type ImageCategory =
	'navigation' | 'communication' | 'media' | 'files' | 'commerce' | 'people' | 'system' | 'custom';

/** Metadata for a predefined image category. */
export type ImageCategoryOption = {
	/** Category key stored in the database. */
	value: ImageCategory;
	/** Human-readable label shown in filters and forms. */
	label: string;
	/** Short description of what belongs in this category. */
	description: string;
};

/** Predefined categories available when creating, importing or filtering images. */
export const imageCategories: readonly ImageCategoryOption[] = [
	{
		value: 'navigation',
		label: 'Navigation & UI',
		description: 'Menus, search, links, switches and layout controls'
	},
	{
		value: 'communication',
		label: 'Communication',
		description: 'Chat, dial, mail, sharing and video calls'
	},
	{
		value: 'media',
		label: 'Media & Audio',
		description: 'Music, sound, earphones, video, camera and playback'
	},
	{
		value: 'files',
		label: 'Files & Cloud',
		description: 'Folders, documents, cloud storage, bookmarks and reports'
	},
	{
		value: 'commerce',
		label: 'Commerce & Rewards',
		description: 'Shopping, gifts, subscriptions, calculators, value and trophies'
	},
	{
		value: 'people',
		label: 'People & Social',
		description: 'Avatars, profiles, likes and reactions'
	},
	{
		value: 'system',
		label: 'System & Security',
		description: 'Settings, locks, keys, Wi-Fi, Bluetooth and time'
	},
	{
		value: 'custom',
		label: 'Custom',
		description: 'User-created or imported images and illustrations'
	}
] as const;

/** Validation limits for managed images. */
export const imageLimits = {
	/** Maximum length of an image display name. */
	nameLength: 80,
	/** Maximum length of a stored URL or path. */
	urlLength: 500,
	/** Maximum number of images stored in the catalog. */
	maxImages: 500,
	/** Maximum uploaded image file size in bytes (2 MB). */
	maxFileBytes: 2 * 1024 * 1024
} as const;

/**
 * A managed image entry in the catalog.
 */
export type ManagedImage = {
	/** Unique identifier (UUID or deterministic seed id). */
	id: string;
	/** Display name (unique, case-insensitive). */
	name: string;
	/** Web path (`/images/...`) or external `https://...` / `data:image/...` URL. */
	url: string;
	/** Predefined category of the image. */
	category: ImageCategory;
	/** `true` for prepopulated default icons. */
	builtIn: boolean;
	/** ISO creation timestamp. */
	createdAt: string;
};

/** Input payload for creating or updating a managed image. */
export type ManagedImageInput = {
	/** Display name of the image. */
	name: string;
	/** Image URL or local server path. */
	url: string;
	/** Predefined category. */
	category: ImageCategory;
};

/**
 * Checks whether an untrusted value is a valid {@link ImageCategory}.
 *
 * @param value - Untrusted input.
 * @returns `true` if `value` is one of the predefined categories.
 */
export function isValidImageCategory(value: unknown): value is ImageCategory {
	return typeof value === 'string' && imageCategories.some((item) => item.value === value);
}

/**
 * Returns the human-readable label for a category key.
 *
 * @param category - Category identifier.
 * @returns Display label.
 */
export function imageCategoryLabel(category: ImageCategory): string {
	return imageCategories.find((item) => item.value === category)?.label ?? 'Custom';
}

/**
 * Normalizes an image display name by collapsing whitespace and trimming.
 *
 * @param raw - Untrusted name input.
 * @returns Trimmed name, or `null` when empty or exceeding {@link imageLimits.nameLength}.
 */
export function normalizeImageName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.replace(/\s+/g, ' ').trim();
	return trimmed.length >= 1 && trimmed.length <= imageLimits.nameLength ? trimmed : null;
}

/**
 * Validates whether a string is a safe, usable image URL or path.
 *
 * Accepts:
 * - Local root-relative paths starting with `/` (but not `//`), e.g. `/images/isometric/menu.svg`
 * - `http://` or `https://` URLs
 * - `data:image/...` URIs
 *
 * @param url - Untrusted URL string.
 * @returns `true` if safe and within length limits.
 */
export function isValidImageUrl(url: unknown): url is string {
	if (typeof url !== 'string') return false;
	const trimmed = url.trim();
	if (trimmed.length === 0 || trimmed.length > imageLimits.urlLength) return false;
	return /^(https?:\/\/[^\s"<>]+|\/(?!\/)[a-z0-9\-_/.~%]+|data:image\/[a-z0-9+.-]+[;,][^\s]*)$/i.test(
		trimmed
	);
}

/**
 * Extracts and normalizes the last path element from a URL or path string.
 *
 * Used to derive the default server subfolder name (`static/images/<folder>/`) when crawling a web
 * collection URL (for example `https://www.svgrepo.com/collection/isometric-3d-interface-icons/` ->
 * `'isometric-3d-interface-icons'`, or `https://example.com/icons/isometric` -> `'isometric'`).
 *
 * @param rawUrl - Any URL or path string.
 * @returns Sanitized kebab-case folder name (`'crawled'` when none can be derived).
 * @example
 * extractUrlLastPathElement('https://www.svgrepo.com/collection/isometric/'); // 'isometric'
 */
export function extractUrlLastPathElement(rawUrl: string): string {
	if (typeof rawUrl !== 'string' || !rawUrl.trim()) return 'crawled';
	let pathname = rawUrl.trim();
	try {
		pathname = new URL(pathname).pathname;
	} catch {
		pathname = pathname.split(/[?#]/)[0] ?? pathname;
	}
	const segments = pathname
		.split('/')
		.map((seg) => seg.trim())
		.filter(Boolean);
	const last = segments.at(-1) ?? '';
	const withoutExt = last.replace(/\.(html?|php|aspx?|json|xml|svg)$/i, '');
	const slug = withoutExt
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return slug || 'crawled';
}

/**
 * Returns the collection / directory path element of a stored image URL.
 *
 * - For `/images/<segment>/<file.svg>` (e.g. `/images/isometric/menu.svg`), returns `<segment>`
 *   (`'isometric'`).
 * - For other paths `/a/b/file.svg`, returns the parent directory segment `'b'`, or `'root'` when
 *   the file sits directly at `/<file.svg>`.
 * - For `data:image/...` URIs, returns `'inline'`.
 *
 * @param url - Image URL or path.
 * @returns The path segment used for filtering (e.g. `'isometric'`).
 * @example
 * imagePathElement('/images/isometric/menu.svg'); // 'isometric'
 * imagePathElement('/video-call-svgrepo-com.svg'); // 'root'
 */
export function imagePathElement(url: string): string {
	if (!url || typeof url !== 'string') return 'root';
	const trimmed = url.trim();
	if (trimmed.startsWith('data:')) return 'inline';
	let pathname = trimmed;
	if (/^https?:\/\//i.test(trimmed)) {
		try {
			pathname = new URL(trimmed).pathname;
		} catch {
			return 'external';
		}
	} else {
		pathname = trimmed.split(/[?#]/)[0] ?? trimmed;
	}
	const parts = pathname.split('/').filter(Boolean);
	if (parts.length >= 3 && parts[0] === 'images') {
		return parts[1];
	}
	if (parts.length >= 2) {
		return parts[parts.length - 2];
	}
	return 'root';
}

/**
 * Lists all distinct path elements present in a collection of images (with `'isometric'` ordered
 * first when present, followed by remaining segments alphabetically).
 *
 * @param images - Managed images to inspect.
 * @returns Ordered array of unique path element strings.
 */
export function listImagePathElements(images: readonly Pick<ManagedImage, 'url'>[]): string[] {
	const set = new Set<string>();
	for (const img of images) {
		set.add(imagePathElement(img.url));
	}
	return [...set].sort((a, b) => {
		if (a === 'isometric') return -1;
		if (b === 'isometric') return 1;
		return a.localeCompare(b);
	});
}

/**
 * Seed definition for prepopulated images.
 */
export type PrepopulatedImageSeed = {
	id: string;
	name: string;
	url: string;
	category: ImageCategory;
};

/**
 * Prepopulated images from https://www.svgrepo.com/collection/isometric-3d-interface-icons/
 * (all 50 isometric 3D interface icons stored in `static/images/isometric/`) plus the existing
 * communication SVG icons in `static/`.
 */
export const prepopulatedImages: readonly PrepopulatedImageSeed[] = [
	// Navigation & UI
	{ id: 'iso-menu', name: 'Menu', url: '/images/isometric/menu.svg', category: 'navigation' },
	{
		id: 'iso-front-page',
		name: 'Front Page',
		url: '/images/isometric/front-page.svg',
		category: 'navigation'
	},
	{ id: 'iso-search', name: 'Search', url: '/images/isometric/search.svg', category: 'navigation' },
	{ id: 'iso-browse', name: 'Browse', url: '/images/isometric/browse.svg', category: 'navigation' },
	{ id: 'iso-link', name: 'Link', url: '/images/isometric/link.svg', category: 'navigation' },
	{ id: 'iso-switch', name: 'Switch', url: '/images/isometric/switch.svg', category: 'navigation' },
	{
		id: 'iso-forward',
		name: 'Forward',
		url: '/images/isometric/forward.svg',
		category: 'navigation'
	},
	{
		id: 'iso-application',
		name: 'Application',
		url: '/images/isometric/application.svg',
		category: 'navigation'
	},
	{
		id: 'iso-location',
		name: 'Location',
		url: '/images/isometric/location.svg',
		category: 'navigation'
	},
	{ id: 'iso-pen', name: 'Pen', url: '/images/isometric/pen.svg', category: 'navigation' },
	{ id: 'iso-delete', name: 'Delete', url: '/images/isometric/delete.svg', category: 'navigation' },

	// Communication
	{ id: 'iso-dial', name: 'Dial', url: '/images/isometric/dial.svg', category: 'communication' },
	{ id: 'iso-share', name: 'Share', url: '/images/isometric/share.svg', category: 'communication' },
	{
		id: 'iso-the-internet',
		name: 'The Internet',
		url: '/images/isometric/the-internet.svg',
		category: 'communication'
	},
	{ id: 'iso-hint', name: 'Hint', url: '/images/isometric/hint.svg', category: 'communication' },
	{
		id: 'iso-information',
		name: 'Information',
		url: '/images/isometric/information.svg',
		category: 'communication'
	},
	{
		id: 'iso-information-alt',
		name: 'Information Bubble',
		url: '/images/isometric/information-alt.svg',
		category: 'communication'
	},
	{
		id: 'static-video-call',
		name: 'Video Call',
		url: '/video-call-svgrepo-com.svg',
		category: 'communication'
	},
	{
		id: 'static-video-chat',
		name: 'Video Chat',
		url: '/video-chat-svgrepo-com.svg',
		category: 'communication'
	},
	{
		id: 'static-videocall-chat',
		name: 'Videocall Chat',
		url: '/videocall-video-chat-svgrepo-com.svg',
		category: 'communication'
	},
	{
		id: 'static-webcam-chat',
		name: 'Webcam Video Chat',
		url: '/webcam-video-chat-svgrepo-com.svg',
		category: 'communication'
	},
	{
		id: 'static-teams-fill',
		name: 'Teams Fill',
		url: '/teams-fill-svgrepo-com.svg',
		category: 'communication'
	},
	{
		id: 'static-teams-outline',
		name: 'Teams Outline',
		url: '/teams-outline-svgrepo-com.svg',
		category: 'communication'
	},
	{
		id: 'static-qq-outline',
		name: 'QQ Outline',
		url: '/qq-outline-svgrepo-com.svg',
		category: 'communication'
	},

	// Media & Audio
	{
		id: 'iso-earphone',
		name: 'Earphone',
		url: '/images/isometric/earphone.svg',
		category: 'media'
	},
	{ id: 'iso-cd', name: 'CD Disc', url: '/images/isometric/cd.svg', category: 'media' },
	{ id: 'iso-mike', name: 'Microphone', url: '/images/isometric/mike.svg', category: 'media' },
	{ id: 'iso-video', name: 'Video', url: '/images/isometric/video.svg', category: 'media' },
	{ id: 'iso-sound', name: 'Sound', url: '/images/isometric/sound.svg', category: 'media' },
	{ id: 'iso-picture', name: 'Picture', url: '/images/isometric/picture.svg', category: 'media' },
	{ id: 'iso-music', name: 'Music', url: '/images/isometric/music.svg', category: 'media' },
	{
		id: 'iso-take-pictures',
		name: 'Take Pictures',
		url: '/images/isometric/take-pictures.svg',
		category: 'media'
	},
	{ id: 'iso-play', name: 'Play', url: '/images/isometric/play.svg', category: 'media' },

	// Files & Cloud
	{ id: 'iso-folder', name: 'Folder', url: '/images/isometric/folder.svg', category: 'files' },
	{
		id: 'iso-document',
		name: 'Document',
		url: '/images/isometric/document.svg',
		category: 'files'
	},
	{ id: 'iso-cloud', name: 'Cloud', url: '/images/isometric/cloud.svg', category: 'files' },
	{
		id: 'iso-bookmark',
		name: 'Bookmark',
		url: '/images/isometric/bookmark.svg',
		category: 'files'
	},
	{ id: 'iso-collect', name: 'Collect', url: '/images/isometric/collect.svg', category: 'files' },
	{ id: 'iso-report', name: 'Report', url: '/images/isometric/report.svg', category: 'files' },

	// Commerce & Rewards
	{
		id: 'iso-shopping',
		name: 'Shopping',
		url: '/images/isometric/shopping.svg',
		category: 'commerce'
	},
	{
		id: 'iso-subscription',
		name: 'Subscription',
		url: '/images/isometric/subscription.svg',
		category: 'commerce'
	},
	{
		id: 'iso-calculator',
		name: 'Calculator',
		url: '/images/isometric/calculator.svg',
		category: 'commerce'
	},
	{ id: 'iso-value', name: 'Value', url: '/images/isometric/value.svg', category: 'commerce' },
	{ id: 'iso-gift', name: 'Gift', url: '/images/isometric/gift.svg', category: 'commerce' },
	{ id: 'iso-trophy', name: 'Trophy', url: '/images/isometric/trophy.svg', category: 'commerce' },

	// People & Social
	{
		id: 'iso-personal',
		name: 'Personal Profile',
		url: '/images/isometric/personal.svg',
		category: 'people'
	},
	{ id: 'iso-male', name: 'Male', url: '/images/isometric/male.svg', category: 'people' },
	{ id: 'iso-female', name: 'Female', url: '/images/isometric/female.svg', category: 'people' },
	{ id: 'iso-like', name: 'Like Heart', url: '/images/isometric/like.svg', category: 'people' },
	{
		id: 'iso-thumbs-up',
		name: 'Thumbs Up',
		url: '/images/isometric/thumbs-up.svg',
		category: 'people'
	},

	// System & Security
	{ id: 'iso-set-up', name: 'Set Up', url: '/images/isometric/set-up.svg', category: 'system' },
	{ id: 'iso-adjust', name: 'Adjust', url: '/images/isometric/adjust.svg', category: 'system' },
	{ id: 'iso-lock', name: 'Lock', url: '/images/isometric/lock.svg', category: 'system' },
	{ id: 'iso-key', name: 'Key', url: '/images/isometric/key.svg', category: 'system' },
	{ id: 'iso-time', name: 'Time', url: '/images/isometric/time.svg', category: 'system' },
	{ id: 'iso-wifi', name: 'Wi-Fi', url: '/images/isometric/wifi.svg', category: 'system' },
	{
		id: 'iso-bluetooth',
		name: 'Bluetooth',
		url: '/images/isometric/bluetooth.svg',
		category: 'system'
	}
] as const;
