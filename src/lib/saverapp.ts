// Fork: the Screen saver app (screens/SaverApp.tsx) talks to the Mac that makes the saver's daily mix (~/tv-saver on the
// M1: gallery/server.py). It lists every aerial, painting and photo, says which are on the TV today, hides the ones
// not wanted, and keeps how many of each the mix gets. Plain XMLHttpRequest (the web view of older TVs has no fetch).

import {exec} from './apps';
import {isWebOS} from './luna';

/** The Mac's address on the home network; localStorage 'hearth-saver-server' overrides it (testing, another Mac). */
export const SAVER_SERVER_DEFAULT = 'http://MacBookPro.fritz.box:8875';

export function saverServer (): string {
	try { return (window.localStorage.getItem('hearth-saver-server') || SAVER_SERVER_DEFAULT).replace(/\/+$/, ''); } catch (e) { return SAVER_SERVER_DEFAULT; }
}

export type SaverKind = 'aerials' | 'art' | 'photos';
export const SAVER_KINDS: readonly SaverKind[] = ['aerials', 'art', 'photos'];

export interface SaverItem {
	kind: SaverKind;
	id: string;
	title: string;
	sub: string;
	credit?: string;
	thumb: string;
	/** the full 1920x1080 picture (art, photos) */
	full?: string;
	/** a 1080p video on Apple's server (aerials) */
	video?: string;
	date?: string;
}

export type SaverCounts = Record<SaverKind, number>;

export interface SaverState {
	day: string | null;
	today: Record<SaverKind, string[]>;
	hidden: Partial<Record<SaverKind, string[]>>;
	counts: SaverCounts;
	rotating: boolean;
}

/** Steps for "how many per day": aerials one by one (each is ~330 MB on the TV), pictures in fives. */
export const COUNT_STEPS: Record<SaverKind, readonly number[]> = {
	aerials: [0, 1, 2, 3, 4, 5, 6, 7, 8],
	art: [0, 5, 10, 15, 20, 25, 30, 40, 50, 60],
	photos: [0, 5, 10, 15, 20, 25, 30, 40, 50, 60]
};

/** The next value in `steps` from `value` (snapping to the nearest step first), clamped at the ends. */
export function stepValue (steps: readonly number[], value: number, dir: 1 | -1): number {
	let at = 0;
	steps.forEach((v, i) => { if (Math.abs(v - value) < Math.abs(steps[at] - value)) at = i; });
	if (steps[at] !== value && ((dir > 0 && steps[at] > value) || (dir < 0 && steps[at] < value))) return steps[at];
	return steps[Math.max(0, Math.min(steps.length - 1, at + dir))];
}

function request<T> (method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const r = new XMLHttpRequest();
		r.open(method, saverServer() + path, true);
		r.timeout = timeoutMs;
		r.onload = () => {
			if (r.status < 200 || r.status >= 300) { reject(new Error('HTTP ' + r.status)); return; }
			try { resolve(JSON.parse(r.responseText) as T); } catch (e) { reject(e); }
		};
		r.onerror = () => reject(new Error('network error'));
		r.ontimeout = () => reject(new Error('timed out'));
		if (body !== undefined) r.setRequestHeader('Content-Type', 'application/json');
		r.send(body === undefined ? null : JSON.stringify(body));
	});
}

export const loadItems = (): Promise<SaverItem[]> => request<SaverItem[]>('GET', '/data.json');
export const loadState = (): Promise<SaverState> => request<SaverState>('GET', '/api/state');
export const setHidden = (item: SaverItem, hidden: boolean): Promise<{hidden: SaverState['hidden']}> =>
	request('POST', '/api/hide', {kind: item.kind, id: item.id, hidden});
export const saveCounts = (counts: Partial<SaverCounts>): Promise<SaverCounts> => request<SaverCounts>('POST', '/api/settings', counts);
export const newMix = (): Promise<{rotating: boolean}> => request('POST', '/api/rotate', {});

/** A picture's address on the Mac (the lists hold paths relative to the server). */
export const onServer = (path: string): string => (/^https?:/.test(path) ? path : saverServer() + '/' + path.replace(/^\/+/, ''));

// ----- what the saver shows: everything, only the aerials, or only the pictures (art + photos) -----
// The saver plays one folder (Hearth's screensaverSource, found with `find -L`). "Only pictures" is a folder of two links,
// to the art and photos folders of the daily mix, so the choice works at once and the daily mix itself never changes.

export const SAVER_MIX_DIR = '/media/developer/screensavers';
export const SAVER_PICTURES_DIR = '/media/developer/screensavers-pictures';
export type SaverShow = 'all' | 'aerials' | 'pictures';
export const SAVER_SHOW_VALUES: readonly SaverShow[] = ['all', 'aerials', 'pictures'];

export function showOf (source: string): SaverShow | 'other' {
	const s = source.replace(/\/+$/, '');
	return s === SAVER_MIX_DIR ? 'all' : s === SAVER_MIX_DIR + '/aerials' ? 'aerials' : s === SAVER_PICTURES_DIR ? 'pictures' : 'other';
}

export function sourceFor (show: SaverShow): string {
	return show === 'aerials' ? SAVER_MIX_DIR + '/aerials' : show === 'pictures' ? SAVER_PICTURES_DIR : SAVER_MIX_DIR;
}

/** Makes (or repairs) the "only pictures" folder: links to the mix's art and photos folders. */
export const PICTURES_DIR_COMMAND = `mkdir -p '${SAVER_PICTURES_DIR}' && ln -sfn ../screensavers/art '${SAVER_PICTURES_DIR}/art' && ln -sfn ../screensavers/photos '${SAVER_PICTURES_DIR}/photos' && echo ok`;

export function ensurePicturesDir (): Promise<boolean> {
	if (!isWebOS()) return Promise.resolve(false);
	return exec(PICTURES_DIR_COMMAND, 8000).then((out) => /ok/.test(out), () => false);
}

// ----- how long the TV waits before the saver starts: the TV's own setting (option.screenSaverTimer, minutes) -----
// The TV only accepts these four values (getSystemSettingDesc); it needs root, like the other system settings.

export const SAVER_DELAY_VALUES: readonly number[] = [3, 10, 20, 30];
const DELAY_GET = `luna-send -n 1 -f luna://com.webos.settingsservice/getSystemSettings '{"category":"option","keys":["screenSaverTimer"]}'`;

export function delayCommand (minutes: number): string {
	if (SAVER_DELAY_VALUES.indexOf(minutes) === -1) throw new Error('not a screen saver delay');
	return `luna-send -n 1 -f luna://com.webos.settingsservice/setSystemSettings '{"category":"option","settings":{"screenSaverTimer":"${minutes}","checkChangedScreenSaverTimerByUser":"user"}}'`;
}

export function parseDelay (out: string): number | null {
	const m = /"screenSaverTimer"\s*:\s*"?(\d+)/.exec(out);
	return m ? Number(m[1]) : null;
}

export function getSaverDelay (): Promise<number | null> {
	if (!isWebOS()) return Promise.resolve(null);
	return exec(DELAY_GET, 6000).then(parseDelay, () => null);
}

export function setSaverDelay (minutes: number): Promise<boolean> {
	if (!isWebOS()) return Promise.resolve(false);
	return exec(delayCommand(minutes), 6000).then((out) => /"returnValue"\s*:\s*true/.test(out), () => false);
}
