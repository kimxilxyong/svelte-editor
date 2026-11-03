/**
 * @fileoverview Starter image links from SVG Repo's Isometric 3D Interface Icons collection.
 *
 * The collection identifies these 50 icons as CC0. We store links to the original files rather
 * than redistributing their artwork. Source and license:
 * https://www.svgrepo.com/collection/isometric-3d-interface-icons/
 * https://www.svgrepo.com/page/licensing/
 */

import type { ImageExportRecord } from './image-types.js';

const icons = [
	['Menu', 'menu'],
	['Dial', 'dial'],
	['Subscription', 'subscription'],
	['Pen', 'pen'],
	['The Internet', 'the-internet'],
	['Earphone', 'earphone'],
	['Calculator', 'calculator'],
	['Share', 'share'],
	['Shopping', 'shopping'],
	['Value', 'value'],
	['Cd', 'cd'],
	['Personal', 'personal'],
	['Bluetooth', 'bluetooth'],
	['Gift', 'gift'],
	['Link', 'link'],
	['Switch', 'switch'],
	['Trophy', 'trophy'],
	['Browse', 'browse'],
	['Mike', 'mike'],
	['Video', 'video'],
	['Delete', 'delete'],
	['Male', 'male'],
	['Female', 'female'],
	['Set Up', 'set-up'],
	['Sound', 'sound'],
	['Bookmark', 'bookmark'],
	['Collect', 'collect'],
	['Front Page', 'front-page'],
	['Time', 'time'],
	['Search', 'search'],
	['Picture', 'picture'],
	['Lock', 'lock'],
	['Adjust', 'adjust'],
	['Like', 'like'],
	['Hint', 'hint'],
	['Document', 'document'],
	['Information', 'information'],
	['Folder', 'folder'],
	['Information (2)', 'information'],
	['Location', 'location'],
	['Music', 'music'],
	['Application', 'application'],
	['Thumbs Up', 'thumbs-up'],
	['Cloud', 'cloud'],
	['Take Pictures', 'take-pictures'],
	['Forward', 'forward'],
	['Key', 'key'],
	['Play', 'play'],
	['Wifi', 'wifi'],
	['Report', 'report']
] as const;

/**
 * Builds the initial, linked catalog for one project. Callers persist it once per project and
 * never re-add entries the user has deleted.
 *
 * @returns Fresh image records with stable identifiers and SVG Repo URLs.
 * @example
 * starterImages()[0].name; // 'Menu'
 */
export function starterImages(): ImageExportRecord[] {
	return icons.map(([name, slug], index) => {
		const number = 530481 + index;
		return {
			id: `svgrepo-${number}`,
			name,
			url: `https://www.svgrepo.com/show/${number}/${slug}.svg`,
			category: 'Icons',
			kind: 'link'
		};
	});
}
