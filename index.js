// 适配V3 Yunzai，将index.js移至app/index.js
import {
	currentVersion,
	isV3
} from './components/Changelog.js'
import Data from './components/Data.js'
import moment from 'moment'

if (!global.segment) {
  global.segment = (await import("oicq")).segment
}

export * from './apps/index.js'
let index = {
	atlas: {}
}
if (isV3) {
	Bot.logger=logger
	index = await Data.importModule('/plugins/xiaoyao-cvs-plugin/adapter', 'index.js')
}

export const atlas = index.atlas || {}

Bot.logger.info(`---------^_^---------`)
Bot.logger.info(`图鉴插件${currentVersion}初始化~`)

setTimeout(async function() {
	let msgStr = await redis.get('xiaoyao:restart-msg')
	let relpyPrivate = async function() {}
	if (!isV3) {
		let common = await Data.importModule('/lib', 'common.js')
		if (common && common.default && common.default.relpyPrivate) {
			relpyPrivate = common.default.relpyPrivate
		}
	}
	if (msgStr) {
		let msg = JSON.parse(msgStr)
		await relpyPrivate(msg.qq, msg.msg)
		await redis.del('xiaoyao:restart-msg')
		let msgs = [`当前图鉴版本: ${currentVersion}`, '您可使用 #图鉴版本 命令查看更新信息']
		await relpyPrivate(msg.qq, msgs.join('\n'))
	}
	
	// 检查并恢复未完成的签到任务（仅当天）
	await checkAndResumeTasks()
}, 1000)

async function checkAndResumeTasks() {
	try {
		const User = (await import('./model/user.js')).default
		const user = new User({});
		
		const tasks = ['bbs', 'mys'];
		for (let taskType of tasks) {
			const progressKey = `xiaoyao:task:progress:${taskType}`;
			const progress = await redis.get(progressKey);
			if (progress) {
				const taskData = JSON.parse(progress);
				const today = moment().format('YYYY-MM-DD');
				// 只恢复今天的数据
				if (taskData.date === today && taskData.completed < taskData.total) {
					Bot.logger.mark(`检测到未完成的${taskType === 'bbs' ? '米游币' : '米社'}签到任务，开始恢复...`);
					// 延迟恢复，避免启动时阻塞
					setTimeout(async () => {
						try {
							if (taskType === 'bbs') {
								await user.bbsTask('', true);
							} else if (taskType === 'mys') {
								await user.signTask('', true);
							}
						} catch (error) {
							Bot.logger.error(`恢复${taskType}任务失败: ${error}`);
						}
					}, 5000);
				} else if (taskData.date !== today) {
					// 不是今天的数据，清理
					await redis.del(progressKey);
				}
			}
		}
	} catch (error) {
		Bot.logger.error(`检查任务恢复失败: ${error}`);
	}
}
