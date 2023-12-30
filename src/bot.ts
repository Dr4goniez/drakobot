import { Mwn } from 'mwn';
import { userInfo } from './my';
import * as fs from 'node:fs';

// ***************************************************************************************************************

/** Keyed by a DB name and valued by project-specific user groups. */
interface DbExtraGroupMap {
	[dbname: string]: string[];
}
const userGroups: {
	ignored: string[];
	canonical: string[];
	extra: DbExtraGroupMap;
} = {
	ignored: [
		'*',
		'user',
		'autoconfirmed',
		'steward',
		'import',
		'transwiki',
		'ipblock-exempt',
		// Project-dependent groups
		'editor',
		'uploader',
		'autoreview',
		'autopatrolled',
		'extendedconfirmed',
		'autoeditor',
		'noratelimit',
		'autoreviewer',
		'upload-shared',
		'trusteduser',
		'trusted',
		'autoreviewed',
		'validator',
		'autoextendedconfirmed',
		'upwizcampeditors',
		'eventparticipant',
		'inactive',
		'machinevision-tester',
		'translator',
	],
	canonical: [
		'bot',
		'sysop',
		'interface-admin',
		'bureaucrat',
		'suppress',
		'accountcreator',
		'checkuser'
	],
	extra: {}
};
// [
// 	'rollbacker',
// 	'reviewer',
// 	'extendedmover',
// 	'abusefilter',
// 	'flow-bot',
// 	'patroller',
// 	'pagemover',
// 	'filemover',
// 	'interface-editor',
// 	'flood',
// 	'suppressredirect',
// 	'botadmin',
// 	'arbcom',
// 	'founder',
// 	'abusefilter-helper',
// 	'eventcoordinator',
// 	'researcher',
// 	'templateeditor',
// 	'massmessage-sender',
// 	'copyviobot',
// 	'curator',
// 	'editprotected',
// 	'image-reviewer',
// 	'eliminator',
// 	'translationadmin',
// 	'facilitator',
// 	'mover',
// 	'closer',
// 	'engineer',
// 	'docseditor',
// 	'test-sysop',

// 	'oathauth',
// 	'oauthadmin',
// 	'contentadmin',
// 	'campaignevents-beta-tester',
// 	'centralnoticeadmin',
// 	'global-renamer',
// 	'wmf-officeit',
// 	'wmf-supportsafety',
// 	'push-subscription-manager',
// 	'data-qa',
// 	'qa_automation',
// 	'propertycreator',
// 	'wikidata-staff',
// 	'electcomm',
// 	'staffsupport',
// 	'electionadmin',
// 	'functioneer',
// 	'wikifunctions-staff',
// 	'functionmaintainer'
// ]
// apiportal.wikipedia.org/wiki/Special:ListGroupRights
// incubator.wikimedia.org/wiki/Special:ListGroupRights#translator

// Entry point
init();

// ***************************************************************************************************************

/**
 * 
 * @returns 
 */
async function init(): Promise<void> {

	const mw = await Mwn.init(userInfo);

	const dbMap = await getDbMap(mw);
	if (!dbMap) return;

	const deferreds:  Promise<string[]|null>[] = [];
	const dbs = Object.keys(dbMap);
	for (let i = 0; i < dbs.length; i++) {
		const mwn = dbMap[dbs[i]];
		deferreds.push(getExtraUserGroups(mwn));
		if (i % 100 === 0) {
			await Promise.all(deferreds);
		}
	}
	const extraGroups = await Promise.all(deferreds);

	const allExtraGroups: string[] = [];
	const nullGroupDb: string[] = [];
	const extraGroupsDbMap = extraGroups.reduce((acc: DbExtraGroupMap, arr, i) => {
		const dbname = dbs[i];
		if (!arr) {
			nullGroupDb.push(dbname);
			arr = [];
		}
		acc[dbname] = arr;
		arr.forEach((group) => {
			if (!allExtraGroups.includes(group)) {
				allExtraGroups.push(group);
			}
		});
		return acc;
	}, Object.create(null));

	const merged = Object.assign({}, userGroups, {extra: extraGroupsDbMap});
	fs.writeFileSync('./src/groups.json', JSON.stringify(merged, null, 4), 'utf-8');
	console.log('allExtraGroups', allExtraGroups);
	console.log('nullGroupDb', nullGroupDb);

}

/** Keyed by DB names and valued by Mwn instances. */
interface DbMap {
	[dbname: string]: Mwn;
}
interface ApiResponseSitematrixSite {
	url: string;
	dbname: string;
	code: string;
	lang?: string;
	sitename: string;
	closed?: boolean;
	fishbowl?: boolean;
	nonglobal?: boolean;
	private?: boolean;
}
type ApiResponseSitematrix = {
	count: number;
	specials: ApiResponseSitematrixSite[];
} & {
	[index: string]: {
		code: string;
		name: string;
		site: ApiResponseSitematrixSite[];
		dir: string;
		localname: string;
	};	
};
/**
 * Get Wikimedia sites list and initialize a new Mwn instance for each project.
 * @param mw
 * @returns
 */
function getDbMap(mw: Mwn): Promise<DbMap|null> {
	return mw.request({
		action: 'sitematrix',
		smlimit: 'max',
		formatversion: '2'
	}).then((res) => {
		const resSm: ApiResponseSitematrix|undefined = res && res.sitematrix;
		if (!resSm) return null;
		return Object.keys(resSm).reduce((acc: DbMap, key) => {
			const arr = /^\d+$/.test(key) ? resSm[key].site : key === 'specials' ? resSm.specials : [];
			arr.forEach((obj) => {
				if (!obj.closed && !obj.private && !obj.nonglobal) {
					const apiUrl = obj.url  + '/w/api.php';
					const initializer = Object.assign({}, userInfo, {apiUrl});
					const mwn = new Mwn(initializer);
					mwn.setRequestOptions({timeout: 0});
					acc[obj.dbname] = mwn;
				}
			});
			return acc;
		}, Object.create(null));
	}).catch((err) => {
		console.log(err);
		return null;
	});
}

interface ApiResponseMetaSiteinfoUsergroups {
	name: string;
	rights: string[];
}
/**
 * Get user groups that are unique to a project.
 * @param mw
 * @returns
 */
function getExtraUserGroups(mw: Mwn): Promise<string[]|null> {
	return mw.request({
		action: 'query',
		meta: 'siteinfo',
		siprop: 'usergroups',
		formatversion: '2'
	}).then((res) => {
		const resUg: ApiResponseMetaSiteinfoUsergroups[]|undefined = res && res.query && res.query.usergroups;
		if (!resUg) return null;
		const ignore = userGroups.ignored.concat(userGroups.canonical);
		return resUg.reduce((acc: string[], obj) => {
			const group = obj.name;
			if (!ignore.includes(group) && !acc.includes(group)) {
				acc.push(group);
			}
			return acc;
		}, []);
	}).catch((err) => {
		console.log(err);
		return null;
	});
}