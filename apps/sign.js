import User from "../model/user.js"
import moment from 'moment';
import lodash from 'lodash'
import {
	Data
} from "../components/index.js";
import common from '../../../lib/common/common.js';
const _path = process.cwd();
let ForumData = Data.readJSON(`${_path}/plugins/xiaoyao-cvs-plugin/defSet/json`, "mys")
export const rule = {
	sign: {
		reg: `^#*(${lodash.map(ForumData,v=> v.otherName.join('|')).join('|')}|游戏全部)签到$`,
		describe: "米社规则签到"
	},
	bbsSign: {
		reg: `^#*米游社(原神|崩坏3|崩坏2|未定事件簿|大别野|崩坏星穹铁道|绝区零|全部)签到$`,
		describe: "米游社米游币签到（理论上会签到全部所以区分开了）"
	},
	cloudSign:{
		reg: "^#*云原神签到$",
		describe: "云原神签到"
	},
	seach: {
		reg: `^#*(米游币|米币|云原神)查询$`,
		describe: "米游币、云原神查询"
	},
	cookiesDocHelp: {
		reg: "^#*(米游社|cookies|米游币|stoken|Stoken|云原神|云)(帮助|教程|绑定)$",
		describe: "cookies获取帮助"
	},
	signTask:{
		reg: `^#((米游|米币|云原神))全部签到$`,
		describe: "管理员批量签到命令"
	},
	xiaoyaoSign: {
		reg: "^#逍遥签到$",
		describe: "管理员一键开启所有签到任务"
	},
	queryProgress: {
		reg: "^#(查询|签到)进度$",
		describe: "查询当前签到任务进度"
	},
	forcePauseTask: {
		reg: "^#强制暂停签到(进程|任务)$",
		describe: "强制暂停当前签到进程"
	},
	stopTask: {
		reg: "^#停止签到任务$",
		describe: "停止当前签到任务（清除进度）"
	},
	resumeTask: {
		reg: "^#恢复签到任务$",
		describe: "恢复暂停的签到任务"
	},
	signList: {
		reg: "^#签到列表$",
		describe: "查看所有签到用户列表（合并转发）"
	},
}
export async function cloudSign(e){
	let user = new User(e);
	START = moment().unix();
	if(!e.yuntoken){
		e.reply('尚未绑定云原神账号！')
		return true;
	}
	let res= await user.cloudSign()
	await replyMsg(e, res.message);
	return true;
}
const checkAuth = async function (e) {
  if (!e?.isMaster&&e?.reply) {
    e?.reply(`只有主人才能命令我哦~
    (*/ω＼*)`)
    return false
  }
  return true;
}

export async function signTask(e){
	if (e&&!await checkAuth(e)) {
		return true;
	}
	let user = new User(e);
	let task=e?.msg?.includes("米币")?'bbs':e?.msg?.includes("云原神")?'cloud':e?.msg?.includes("米游")?'mys':''
	if(!task){
		task=e;
		e='';
	}
	if(task==="bbs"){
		await user.bbsTask(e)
	}
	if(task==="cloud"){
		await user.cloudTask(e)
	}
	if(task==="mys"){
		await user.signTask(e)
	}
	return true;
}
export async function cookiesDocHelp(e){
	let user = new User(e);
	e.reply(`【${e.msg.replace(/帮助|教程|绑定/g,"")}帮助】${await user.docHelp(e.msg)}`);
	return true;
}
export async function seach(e){
	let user = new User(e);
	START = moment().unix();
	let res
	if(e.msg.includes('币')){
		res= await user.bbsSeachSign()
	}else{
		res= await user.cloudSeach()
	}
	await replyMsg(e, res.message);
	return true;
}
export async function bbsSign(e) {
	let user = new User(e);
	START = moment().unix();
	let res = await user.bbsSeachSign()
	if(res.isOk&&res?.data?.can_get_points!==0){
		let msg=e.msg.replace(/(米游社|签到|#)/g,"")
		let forumData = await user.getDataList(msg);
		e.reply(`开始尝试${msg}社区签到预计${msg=='全部'?"10-20":"1-3"}分钟~`)
		res=await user.getbbsSign(forumData)
	}
	await replyMsg(e, res.message);
	return true;
}
let START;
export async function sign(e) {
	let user = new User(e);
	START = moment().unix();
	let msg = e.msg.replace(/#|签到|井|米游社|mys|社区/g, "");
	// 处理"游戏全部"的情况
	if (msg === '游戏全部' || msg === '全部') {
		msg = '全部';
	}
	let ForumData = await user.getDataList(msg);
	e.reply(`开始尝试${msg === '全部' ? '全部游戏' : msg}签到\n预计${msg=='全部'?"60":"5-10"}秒~`)
	let res = await user.multiSign(ForumData,true);
	await replyMsg(e, res.message);
	return true;
}
async function replyMsg(e, resultMessage) {
	const END = moment().unix();
	Bot.logger.info(`运行结束, 用时 ${END - START} 秒`);
	resultMessage += `\n用时 ${END - START} 秒`;
	e.reply([segment.at(e.user_id), "\n" + resultMessage]);
}

export async function queryProgress(e) {
	let user = new User(e);
	let progress = await user.getTaskProgress();
	if (!progress || Object.keys(progress).length === 0) {
		e.reply('当前没有正在执行的任务');
		return true;
	}
	
	let msg = '【当前正在执行的任务】\n\n';
	for (let taskType in progress) {
		let task = progress[taskType];
		if (!task || !task.startTime) continue;
		
		let taskName = taskType === 'bbs' ? '米币全部签到' : taskType === 'mys' ? '米游全部签到' : '云原神全部签到';
		let startTime = moment(task.startTime).format('YYYY-MM-DD HH:mm:ss');
		let total = task.total || 0;
		let completed = task.completed || 0;
		let current = task.current || '';
		let elapsed = Math.floor((Date.now() - task.startTime) / 1000);
		let progressPercent = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
		
		// 计算预计剩余时间 (米游币780s/账号，米社平均45s/账号，云原神3.5s/账号)
		let avgTime = taskType === 'bbs' ? 780 : taskType === 'mys' ? 45 : 3.5;
		let remaining = total > completed ? Math.floor((total - completed) * avgTime) : 0;
		let estimatedFinish = moment(task.startTime).add(elapsed + remaining, 'seconds').format('MM-DD HH:mm:ss');
		
		let elapsedStr = formatTime(elapsed);
		let remainingStr = formatTime(remaining);
		
		msg += `【${taskName}】\n`;
		msg += `开始时间：${startTime}\n`;
		msg += `总用户数：${total}\n`;
		msg += `已完成：${completed}/${total}\n`;
		msg += `进度：${progressPercent}%\n`;
		if (current) {
			msg += `当前处理：${current}\n`;
		}
		msg += `已用时间：${elapsedStr}\n`;
		msg += `预计剩余：${remainingStr}\n`;
		msg += `预计完成：${estimatedFinish}\n\n`;
	}
	e.reply(msg);
	return true;
}

function formatTime(seconds) {
	let hours = Math.floor(seconds / 3600);
	let minutes = Math.floor((seconds % 3600) / 60);
	let secs = seconds % 60;
	let str = '';
	if (hours > 0) str += `${hours}小时`;
	if (minutes > 0) str += `${minutes}分钟`;
	if (secs > 0 || str === '') str += `${secs}秒`;
	return str;
}

export async function forcePauseTask(e) {
	const checkAuth = async function (e) {
		if (!e?.isMaster&&e?.reply) {
			e?.reply(`只有主人才能命令我哦~
    (*/ω＼*)`)
			return false
		}
		return true;
	}
	if (!await checkAuth(e)) {
		return true;
	}
	let user = new User(e);
	let result = await user.forcePauseSignTasks();
	e.reply(result);
	// 同时发送给主人用户
	const utils = (await import('../model/mys/utils.js')).default;
	await utils.sendToMaster(result);
	return true;
}

export async function stopTask(e) {
	const checkAuth = async function (e) {
		if (!e?.isMaster&&e?.reply) {
			e?.reply(`只有主人才能命令我哦~
    (*/ω＼*)`)
			return false
		}
		return true;
	}
	if (!await checkAuth(e)) {
		return true;
	}
	let user = new User(e);
	let result = await user.stopSignTasks();
	e.reply(result);
	// 同时发送给主人用户
	const utils = (await import('../model/mys/utils.js')).default;
	await utils.sendToMaster(result);
	return true;
}

export async function resumeTask(e) {
	const checkAuth = async function (e) {
		if (!e?.isMaster&&e?.reply) {
			e?.reply(`只有主人才能命令我哦~
    (*/ω＼*)`)
			return false
		}
		return true;
	}
	if (!await checkAuth(e)) {
		return true;
	}
	let user = new User(e);
	let result = await user.resumeSignTasks();
	e.reply(result);
	// 同时发送给主人用户
	const utils = (await import('../model/mys/utils.js')).default;
	await utils.sendToMaster(result);
	return true;
}

export async function bbsSignList(e) {
	if (!e.isMaster) {
		e.reply(`只有主人才能命令我哦~
    (*/ω＼*)`)
		return true;
	}
	let user = new User(e);
	let msgArray = await user.getBbsSignList();
	if (typeof msgArray === 'string') {
		// 如果没有用户，直接返回字符串
		e.reply(msgArray);
		return true;
	}
	e.reply(common.makeForwardMsg(e, msgArray, `米游币签到用户列表`));
	return true;
}

export async function mysSignList(e) {
	if (!e.isMaster) {
		e.reply(`只有主人才能命令我哦~
    (*/ω＼*)`)
		return true;
	}
	let user = new User(e);
	let msgArray = await user.getMysSignList();
	if (typeof msgArray === 'string') {
		// 如果没有用户，直接返回字符串
		e.reply(msgArray);
		return true;
	}
	e.reply(common.makeForwardMsg(e, msgArray, `米社签到用户列表`));
	return true;
}

export async function signList(e) {
	if (!e.isMaster) {
		e.reply(`只有主人才能命令我哦~
    (*/ω＼*)`)
		return true;
	}
	let user = new User(e);
	let msgArray = await user.getAllSignList();
	if (typeof msgArray === 'string') {
		// 如果出错，直接返回字符串
		e.reply(msgArray);
		return true;
	}
	e.reply(common.makeForwardMsg(e, msgArray, `签到用户列表`));
	return true;
}

export async function xiaoyaoSign(e) {
	const checkAuth = async function (e) {
		if (!e?.isMaster&&e?.reply) {
			e?.reply(`只有主人才能命令我哦~
    (*/ω＼*)`)
			return false
		}
		return true;
	}
	if (!await checkAuth(e)) {
		return true;
	}
	
	e.reply('【逍遥签到】正在启动所有签到任务...\n\n将依次启动：\n1. 米游全部签到\n2. 米币全部签到\n3. 云原神全部签到');
	
	// 启动三个签到任务（异步执行，不阻塞）
	// 添加 sendToMaster 标记，确保消息也发送给主人
	setTimeout(async () => {
		await signTask({ ...e, msg: '米游全部签到', sendToMaster: true });
	}, 1000);
	
	setTimeout(async () => {
		await signTask({ ...e, msg: '米币全部签到', sendToMaster: true });
	}, 2000);
	
	setTimeout(async () => {
		await signTask({ ...e, msg: '云原神全部签到', sendToMaster: true });
	}, 3000);
	
	return true;
}
