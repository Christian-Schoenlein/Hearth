// R2-b: install the newest update. Runs the detached root script of `probeinstallcmd.ts` (download, SHA-256 check,
// appInstallService dev/install, files removed) and reads its log. Only on a press in the update screen, rooted TVs only.

import {exec} from './apps';
import {log} from './log';
import {installLaunch, installText, installWorked, parseInstallLog} from './probeinstallcmd';
import {PROGRESS_READ, installProgress, type InstallProgress} from './installprogress';
import type {UpdateEntry} from './updatecore';

export interface InstallOutcome {ok: boolean}

const wait = (ms: number): Promise<void> => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Reads the log every 2 s (the next read starts after the answer) until the script ends or `until`; `onProgress` gets each reading. */
function poll (until: number, total: number, onProgress?: (p: InstallProgress) => void): Promise<string> {
	return exec(PROGRESS_READ, 8000).then((out) => {
		if (onProgress) onProgress(installProgress(out, total));
		return parseInstallLog(out).ended || Date.now() >= until ? out : wait(2000).then(() => poll(until, total, onProgress));
	});
}

/**
 * Fork: in-app installs are switched off. The update list can be fetched without certificate checks (curl -k / wget
 * --no-check-certificate fallback in weathernet.ts) and its own sha256 is the only check, so a network attacker could get
 * any ipk installed as root. This fork is installed over root ssh instead; the Updates screen only shows the list.
 */
export const IN_APP_INSTALL = false;

/** True when the entry carries everything an install needs (and in-app installs are on). */
export function canInstall (e: UpdateEntry | undefined): boolean {
	return IN_APP_INSTALL && !!e && !!e.ipkUrl && !!e.sha256 && e.size > 0;
}

export function installUpdate (e: UpdateEntry, onProgress?: (p: InstallProgress) => void): Promise<InstallOutcome> {
	if (!IN_APP_INSTALL) { log('update: in-app install is off in this fork'); return Promise.resolve({ok: false}); }
	let launch: string;
	try { launch = installLaunch({url: e.ipkUrl, sha: e.sha256, version: e.version}); } catch (err) { log('update: install not started (bad entry)'); return Promise.resolve({ok: false}); }
	log(`update: install ${e.version} started`);
	return exec(launch, 15000).then(() => poll(Date.now() + 270000, e.size, onProgress)).then((out) => {
		const l = parseInstallLog(out);
		const ok = installWorked(l);
		log(`update: install ${ok ? 'ok' : 'failed'}: ${installText(l)}`.slice(0, 900));
		return {ok};
	}, (err: Error) => { log(`update: install failed (${String(err && err.message ? err.message : err).slice(0, 80)})`); return {ok: false}; });
}
