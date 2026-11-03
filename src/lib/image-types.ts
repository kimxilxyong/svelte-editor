/**
 * @fileoverview Shared, database-independent image-library portability contract.
 *
 * Project exports carry link metadata as-is and managed images as base64 bytes. Consumers must
 * validate and sanitize imported records before persisting or serving them.
 */

/** Supported image-library categories, in display order. */
export const imageCategories = [
	'Photos',
	'Illustrations',
	'Logos',
	'Icons',
	'Backgrounds',
	'Other'
] as const;

/** A category from the shared image-library vocabulary. */
export type ImageCategory = (typeof imageCategories)[number];

/**
 * An image-library entry. Managed URLs use `/media/<id>.<extension>`; linked URLs are not paths
 * that the project importer opens. MIME type and size are present for managed images.
 */
export type ProjectImage = {
	/** Project-scoped stable identifier. */
	id: string;
	/** Display name chosen by the editor. */
	name: string;
	/** Safe, absolute HTTP(S) URL or root-relative path used by widgets. */
	url: string;
	/** Category used to group and filter the library. */
	category: ImageCategory;
	/** External link or image whose validated bytes the application stores. */
	kind: 'link' | 'managed';
	/** Content-derived MIME type for a managed file. */
	mimeType?: string;
	/** Managed file size in bytes, after SVG sanitization. */
	size?: number;
};

/**
 * An image entry transported between the library and project exporter/importer.
 * Managed entries carry their validated bytes in `data` as canonical base64; links omit it.
 * Importers must still validate and sanitize the decoded bytes and metadata before use.
 */
export type ImageExportRecord = ProjectImage & {
	/** Canonical base64-encoded validated file bytes; absent for linked images. */
	data?: string;
};
