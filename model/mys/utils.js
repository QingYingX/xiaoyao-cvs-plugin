import _ from 'lodash';
import moment from 'moment';
import {
	isV3
			} from '../../components/Changelog.js';
export async function sleepAsync(sleepms) {
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			resolve();
		}, sleepms)
	});
}


export async function randomSleepAsync(end) {
	let sleep = 4 * 1000 + _.random((end || 5) * 1000);
	await sleepAsync(sleep);
}
export function randomString(length, os = false) {
	let randomStr = '';
	for (let i = 0; i < length; i++) {
		randomStr += _.sample(os ? '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' :
			'abcdefghijklmnopqrstuvwxyz0123456789');
	}
	return randomStr;
}
export async function redisDel(userId, type = 'bbs') {
	return await redis.del(`xiaoyao:${type}:${userId}`)
}
export async function redisGet(userId, type = 'bbs') {
	return JSON.parse(await redis.get(`xiaoyao:${type}:${userId}`))
}
export async function redisSet(userId="all", type = 'bbs', data, time=0) {
	var dayTime = moment(Date.now()).add('days', 1).format('YYYY-MM-DD 00:00:00')
	var new_date = (new Date(dayTime).getTime() - new Date().getTime()) / 1000 //获取隔天凌晨的时间差
	if (time!==0) {
		new_date = time
	}
	return await redis.set(`xiaoyao:${type}:${userId}`, JSON.stringify(data), {
		EX: parseInt(new_date)
	});
}

/**
 * 发送私聊消息，仅给好友发送
 * @param user_id qq号
 * @param msg 消息
 */
export async function relpyPrivate(userId, msg) {
	userId = Number(userId) || userId
	let friend = Bot.fl.get(userId)
	if (friend) {
		Bot.logger.mark(`发送好友消息[${friend.nickname}](${userId})`)
		try {
			const result = await Bot.pickUser(userId).sendMsg(msg);
			Bot.logger.mark(`好友消息发送成功: ${userId}`);
			return result;
		} catch (err) {
			Bot.logger.error(`发送好友消息失败[${userId}]: ${err}`);
			throw err; // 抛出错误，让调用者知道发送失败
		}
	} else {
		Bot.logger.warn(`无法发送好友消息: QQ${userId} 不是好友`);
		return null;
	}
}

/**
 * 发送消息给主人
 * @param msg 消息内容
 * @param botUin 机器人账号，默认使用 Bot.uin
 * @param sleep 发送间隔（毫秒），默认5000
 */
export async function sendToMaster(msg, botUin = Bot.uin, sleep = 5000) {
	try {
		// 优先使用 Bot.sendMasterMsg
		if (typeof Bot.sendMasterMsg === 'function') {
			return await Bot.sendMasterMsg(msg, botUin, sleep);
		}
		
		// 直接从系统配置获取主人QQ列表（完整数组）
		let masterQQ = [];
		try {
			// 直接从系统配置读取完整的 masterQQ 数组
			if (typeof isV3 !== 'undefined' && isV3) {
				const config = (await import(`file://${process.cwd()}/lib/config/config.js`)).default;
				masterQQ = config.masterQQ || [];
			} else if (typeof BotConfig !== 'undefined') {
				masterQQ = BotConfig.masterQQ || [];
			}
			
			// 如果还是空，尝试通过 gsCfg 获取（兼容旧逻辑）
			if (!masterQQ || masterQQ.length === 0) {
				const gsCfg = (await import('../gsCfg.js')).default;
				const masterQQValue = await gsCfg.getMasterQQ();
				if (masterQQValue) {
					masterQQ = [masterQQValue];
				}
			}
		} catch (error) {
			Bot.logger.error(`获取主人QQ失败: ${error.message}`);
		}
		
		if (!masterQQ || masterQQ.length === 0) {
			Bot.logger.warn(`无法发送消息给主人：主人QQ未配置`);
			return false;
		}
		
		// 过滤掉无效的QQ号（stdin等）
		masterQQ = masterQQ.filter(qq => {
			const qqStr = String(qq).trim();
			return qqStr && qqStr !== '' && qqStr !== 'stdin';
		});
		
		if (masterQQ.length === 0) {
			Bot.logger.warn(`无法发送消息给主人：所有主人QQ都无效`);
			return false;
		}
		
		// 检查是否为stdin适配器
		if (typeof Bot !== 'undefined' && Bot.uin) {
			let uinStr = String(Bot.uin);
			if (uinStr === 'stdin' || uinStr.includes('stdin')) {
				Bot.logger.warn(`无法发送消息给主人：当前为stdin适配器`);
				return false;
			}
		}
		
		// 发送消息给所有主人（简化逻辑，直接发送给所有主人）
		const common = (await import(`file://${process.cwd()}/lib/common/common.js`)).default;
		
		if (masterQQ.length === 1) {
			// 只有一个主人，直接发送
			return await common.relpyPrivate(masterQQ[0], msg, botUin);
		} else {
			// 多个主人，循环发送
			for (const qq of masterQQ) {
				try {
					await common.relpyPrivate(qq, msg, botUin);
					if (sleep > 0 && masterQQ.indexOf(qq) < masterQQ.length - 1) {
						await common.sleep(sleep);
					}
				} catch (error) {
					Bot.logger.error(`发送消息给主人失败[${qq}]: ${error.message || error}`);
				}
			}
			return true;
		}
	} catch (error) {
		Bot.logger.error(`发送消息给主人失败: ${error.message || error}`);
		return false;
	}
}
export async function replyMake(e, _msg, lenght) {
	const bot = e.bot || Bot
	let nickname = bot.nickname;
	if (e.isGroup && bot.getGroupMemberInfo) try {
		const info = await bot.getGroupMemberInfo(e.group_id, bot.uin)
		nickname = info.card || info.nickname
	} catch {}
	let msgList = [];
	for (let [index, item] of Object.entries(_msg)) {
		if (index < lenght) {
			continue;
		}
		msgList.push({
			message: item,
			nickname: nickname,
			user_id: bot.uin
		})
	}
	if (e.isGroup) {
		msgList = await e.group.makeForwardMsg(msgList)
	} else {
		msgList = await e.friend.makeForwardMsg(msgList)
	}
	if (e._reply) {
		e._reply(msgList);
	} else {
		e.reply(msgList);
	}
}

export function getServer(uid) {
	switch (String(uid)[0]) {
		case '1':
		case '2':
			return 'cn_gf01' // 官服
		case '5':
			return 'cn_qd01' // B服
		case '6':
			return 'os_usa' // 美服
		case '7':
			return 'os_euro' // 欧服
		case '8':
			return 'os_asia' // 亚服
		case '9':
			return 'os_cht' // 港澳台服
	}
	return 'cn_gf01'
}
export async function getCookieMap(cookie) {
	let cookieArray = cookie.replace(/\s*/g, "").split(";");
	let cookieMap = new Map();
	for (let item of cookieArray) {
		let entry = item.replace('=','~').split("~");
		if (!entry[0]) continue;
		cookieMap.set(entry[0], entry[1]);
	}
	return cookieMap || {};
}
/**
 * 
 * @param {e} e 
 * @param {撤回的消息id} r 
 * @param {多久撤回(秒)} times 
 */
export function recallMsg(e,r,times){
	setTimeout(()=>{
		if(e?.group?.recallMsg&&r?.message_id){
			e?.group?.recallMsg(r?.message_id)
		}else if(e?.friend?.recallMsg&&r?.message_id){
			e?.friend?.recallMsg(r?.message_id)
		}
	},1000 * times)
}


export default {
	sleepAsync,redisDel,
	getServer,
	randomSleepAsync,
	replyMake,
	randomString,
	redisGet,
	redisSet,recallMsg,
	relpyPrivate,
	getCookieMap,
	sendToMaster
}