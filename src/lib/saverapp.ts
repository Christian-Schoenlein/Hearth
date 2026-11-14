// Fork: the Screen saver app (screens/SaverApp.tsx) talks to the Mac that makes the saver's daily mix (~/tv-saver on the
// M1: gallery/server.py). It lists every aerial, painting and photo, says which are on the TV today, hides the ones
// not wanted, and keeps how many of each the mix gets. Plain XMLHttpRequest (the web view of older TVs has no fetch).

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
