import YAML from 'yaml'
import miHoYoApi from "../model/mys/mihoyoApi.js"
import fs from 'node:fs'
import lodash from 'lodash'
import utils from '../model/mys/utils.js';
import gsCfg from './gsCfg.js';
import {
    isV3
} from '../components/Changelog.js';
import {
    Cfg,
    Data
} from "../components/index.js";
import moment from 'moment'

const _path = process.cwd();
const plugin = "xiaoyao-cvs-plugin"
const nameData = ["原神", "崩坏3", "崩坏2", "未定事件簿"];
const yamlDataUrl = `${_path}/plugins/xiaoyao-cvs-plugin/data/yaml`;
const cloudDataUrl = `${_path}/plugins/xiaoyao-cvs-plugin/data/yunToken/`
let bbsTask = false;
let cloudTask = false;
let mysTask = false;
/** 配置文件 */
export default class user {
    constructor(e) {
        this.e = e;
        this.stokenPath = `./plugins/${plugin}/data/yaml/`
        this.yunPath = `./plugins/${plugin}/data/yunToken/`;
        Data.createDir("", this.yunPath, false)
        this.ForumData = Data.readJSON(`${_path}/plugins/xiaoyao-cvs-plugin/defSet/json`, "mys")
        this.configSign = gsCfg.getfileYaml(`${_path}/plugins/xiaoyao-cvs-plugin/config/`, "config");
        this.configSign.signlist = this.configSign.signlist || "原神|崩坏3|崩坏2|未定事件簿".split("|")
        this.getToken = this.configSign.getToken || ''
        this.getyunToken(this.e)
    }

    async getCkData() {
        let sumData = {};
        let yunres = await this.cloudSeach();
        let yundata = yunres.data
        if (yunres.retcode === 0) {
            sumData["云原神"] = {
                "今日可获取": yundata?.coin?.free_coin_num,
                "米云币": yundata?.coin?.coin_num,
                "免费时长": yundata?.free_time?.free_time,
                "总时长": yundata.total_time
            }
        }
        let mysres = await this.bbsSeachSign();
        if (mysres.retcode === 0) {
            sumData["米游社"] = {
                "米游币任务": mysres.data.can_get_points != 0 ? "未完成" : "已完成",
                "米游币余额": mysres.data.total_points,
                "今日剩余可获取": mysres.data.can_get_points
            }
        }
        let resSign = await this.multiSign(this.ForumData);
        if (resSign?.upData) {
            for (let item of resSign?.upData) {
                let num = lodash.random(0, 9999);
                item.upName = item.upName == "原神" ? "ys" : item.upName == "崩坏3" ? "bh3" : item.upName ==
                    "崩坏2" ? "bh2" : item.upName == "未定事件簿" ? "wdy" : item.upName
                sumData[item.upName + "" + num] = {
                    "uid": item.game_uid,
                    "游戏昵称": item.nickname,
                    "等级": item.level,
                    "今日签到": item.is_sign ? "已签到" : "未签到",
                    "累计签到": item.total_sign_day + "天",
                    "今天奖励": item.awards
                }
            }
        }
        return sumData;
    }

    async getData(type, data = {}, isck = true) {
        if (isck) {
            await this.cookie(this.e)
        }
        this.miHoYoApi = new miHoYoApi(this.e);
        let res = await this.miHoYoApi.getData(type, data)
        return res
    }

    async multiSign(forumData, isCk = false) {
        let upData = [],
            message = '';
        if (isCk) {
            await this.cookie(this.e)
        }
        for (let forum of forumData) {
            if (!(this.configSign.signlist.includes(forum.name))) {
                continue;
            }
            let res
            try {
                message += `**${forum.name}**\n`
                res = await this.getData("userGameInfo", forum, false)
                await utils.sleepAsync(3000) //等几毫秒免得请求太频繁了
                if (res.retcode === -100) {
                    message = `用户：${this.e.user_id}：cookie失效`
                    // 标记需要删除失效账号
                    if (this.e.isTask) {
                        this.e.ckInvalid = true;
                    }
                    return {
                        message,
                        upData
                    };
                }
                if (res?.data?.list?.length === 0 || !res?.data?.list) {
                    message += `签到: 未绑定${forum.name}信息\n`;
                    if (this.allSign) {
                        this.allSign[forum.name].bindGame++;
                    }
                    await utils.randomSleepAsync()
                    continue;
                }
                message += `${forum.name}共计${res?.data?.list.length}个账号\n`;

                for (let item of res?.data?.list) {
                    let data = Object.assign({}, forum, item)
                    item.is_sign = true;
                    item.upName = forum.name
                    res = await this.getData("isSign", data, false)
                    await utils.sleepAsync(500)
                    item.total_sign_day = res?.data?.total_sign_day
                    if (res?.data?.is_sign) {
                        if (this.allSign) {
                            this.allSign[forum.name].isSign++;
                        }
                        message += `${item.nickname}-${item.game_uid}：今日已签到~\n`;
                    } else {
                        let signMsg = '';
                        for (let i = 0; i < 2; i++) { //循环请求
                            await utils.sleepAsync(2000)
                            res = await this.getData("sign", data, false)
                            if (res?.data?.gt) {
                                let validate = await this.geetest(res.data)
                                if (validate) {
                                    let header = {}
                                    header["x-rpc-challenge"] = res["data"]["challenge"]
                                    header["x-rpc-validate"] = validate
                                    header["x-rpc-seccode"] = `${validate}|jordan`
                                    data.headers = header
                                    res = await this.getData("sign", data, false)
                                    if (!res?.data?.gt) {
                                        if (this.allSign) {
                                            this.allSign[forum.name].sign++;
                                        }
                                        signMsg = `${item.nickname}-${item.game_uid}:验证码签到成功~\n`
                                        item.total_sign_day++;
                                        break;
                                    } else {
                                        if (this.allSign) {
                                            this.allSign[forum.name].error++;
                                        }
                                        item.is_sign = false;
                                        signMsg =
                                            `${item.nickname}-${item.game_uid}:签到出现验证码~\n请晚点后重试，或者手动上米游社签到\n`;
                                    }
                                } else {
                                    if (this.allSign) {
                                        this.allSign[forum.name].error++;
                                    }
                                    signMsg = `${item.nickname}-${item.game_uid}:验证码失败~\n`
                                }

                            } else {
                                if (this.allSign) {
                                    this.allSign[forum.name].sign++;
                                }
                                item.total_sign_day++;
                                signMsg =
                                    `${item.nickname}-${item.game_uid}：${res.message == "OK" ? "签到成功" : res.message}\n`
                                break;
                            }
                        }
                        message += signMsg
                    }
                    //获取签到信息和奖励信息
                    const SignInfo = await this.getData("home", data, false)
                    if (SignInfo) {
                        let awards = SignInfo.data.awards[item.total_sign_day - 1];
                        item.awards = awards?.name + "*" + awards?.cnt
                    }
                    upData.push(item)
                    await utils.randomSleepAsync()
                }
            } catch (e) {
                if (this.allSign) {
                    this.allSign[forum.name].error++;
                }
                Bot.logger.error(`${forum.name} 签到失败 [${res?.message}]`);
                message += `签到失败: [${res?.message}]\n`;
            }
        }
        return {
            message,
            upData,
            ckInvalid: this.e.ckInvalid || false
        }
    }

    async docHelp(type) {
        return this.configSign[type.includes("云") ? "cloudDoc" : "cookiesDoc"]
    }

    async cloudSign() {
        await this.cloudSeach()
        let res = await this.getData("cloudReward")
        Bot.logger.mark(`\n云原神签到用户:${this.e.user_id}:[接口返回]${res.message}\n`)
        if (res?.data?.list?.length == 0 || !res?.data?.list) {
            res.message = `您今天的奖励已经领取了~`
        } else {
            let sendMsg = ``
            for (let item of res?.data?.list) {
                let reward_id = item.id;
                let reward_msg = item.msg;
                res = await this.getData("cloudGamer", {
                    reward_id
                })
                // let row=JSON.parse(reward_msg);
                sendMsg += `\n领取奖励,ID:${reward_id},Msg:${reward_msg}`
            }
            res.message = sendMsg;
        }
        Bot.logger.mark(`\n云原神签到用户:${this.e.user_id}:${res.message}\n`)
        return res
    }

    async cloudSeach() {
        let res = await this.getData("cloudGet")
        if (res?.retcode == -100) {
            res.message = "云原神token失效/防沉迷"
            res.isOk = false;
        } else {
            res.isOk = true;
            if (res?.data?.total_time) {
                res.message =
                    `米云币:${res?.data?.coin?.coin_num},免费时长:${res?.data?.free_time?.free_time}分钟,总时长:${res?.data?.total_time}分钟`;
            }
        }
        return res;
    }

    async bbsSeachSign() {
        let res = await this.getData("bbsisSign", {
            name: "原神"
        })
        if (!res?.data) {
            res.message = `登录Stoken失效请重新获取cookies或stoken保存~`;
            res.isOk = false;
            this.delSytk(yamlDataUrl, this.e)
        } else {
            res.message = `当前米游币数量为：${res.data.total_points},今日剩余可获取：${res.data.can_get_points}`
            res.isOk = true;
        }
        return res;
    }

    async getbbsSign(forumData) {
        let message = '',
            challenge = '',
            res;
        let hasInvalidError = false; // 记录是否有失效错误
        try {
            res = await this.bbsSeachSign()
            // 即使bbsSeachSign返回-100，也继续尝试签到，因为可能只是查询接口问题
            if (res?.retcode == -100) {
                hasInvalidError = true;
                Bot.logger.mark(`[米游币签到] bbsSeachSign返回-100，但继续尝试签到: QQ${this.e.user_id}`);
            }
            if (res?.data?.can_get_points == 0) {
                return {
                    message: `签到任务已完成，无需重复签到`
                }
            }
            for (let forum of forumData) {
                let trueDetail = 0;
                let Vote = 0;
                let Share = 0;
                let sumcount = 0;
                message += `\n**${forum.name}**\n`
                res = await this.getData("bbsSign", forum, false)
                // 只有在bbsSign也返回-100时才标记为失效（这是关键的签到接口）
                if (res?.retcode == -100) {
                    hasInvalidError = true;
                    Bot.logger.mark(`[米游币签到] bbsSign返回-100，标记为失效: QQ${this.e.user_id}`);
                    // 标记需要删除失效账号
                    if (this.e.isTask) {
                        this.e.bbsCkInvalid = true;
                    }
                    return {
                        message: '请登录后重试（-100）',
                        ckInvalid: true
                    }
                }
                if (res?.retcode == 1034) {
                    challenge = await this.bbsGeetest()
                    if (challenge) {
                        forum["headers"] = {
                            "x-rpc-challenge": challenge
                        }
                        res = await this.getData("bbsSign", forum, false)
                        if (res?.retcode == 1034) {
                            message += `社区签到: 验证码失败\n`;
                        } else {
                            message += `社区签到: 验证码成功\n`;
                        }
                    } else {
                        message += `社区签到: 验证码失败\n`;
                    }
                } else {
                    message += `社区签到: ${res.message}\n`;
                }
                Bot.logger.mark(`${this.e.user_id}:${this.e.uid}:${forum.name} 社区签到结果: [${res.message}]`);
                res = await this.getData("bbsPostList", forum, false)
                sumcount++;
                let postList = res.data.list;
                let postId
                for (let post of postList) {
                    post = post.post;
                    postId = post['post_id']
                    res = await this.getData("bbsPostFull", {
                        postId
                    }, false)
                    if (res?.message && res?.retcode == 0) {
                        trueDetail++;
                    }
                    if (res?.retcode == 1034) {
                        challenge = await this.bbsGeetest()
                        if (challenge) {
                            let data = {
                                postId,
                                headers: {
                                    "x-rpc-challenge": challenge,
                                }
                            }
                            await this.getData("bbsPostFull", data, false)
                        }
                    }
                    res = await this.getData("bbsVotePost", {
                        postId
                    }, false)
                    if (res?.message && res?.retcode == 0) {
                        Vote++;
                    }
                    if (res?.retcode == 1034) {
                        challenge = await this.bbsGeetest()
                        if (challenge) {
                            let data = {
                                postId,
                                headers: {
                                    "x-rpc-challenge": challenge,
                                }
                            }
                            await this.getData("bbsVotePost", data, false)
                        }
                    }
                    await utils.randomSleepAsync(2);
                }
                res = await this.getData("bbsShareConf", {
                    postId
                }, false)
                if (res?.message && res?.retcode == 0) {
                    Share++;
                }
                message += `共读取帖子记录${20 * sumcount}\n浏览：${trueDetail}  点赞：${Vote}  分享：${Share}\n`;
                Bot.logger.mark(`\n用户${this.e.user_id}:\n${message}`)
                await utils.randomSleepAsync(3);
            }
        } catch (ex) {
            Bot.logger.error(`出问题了：${ex}`);
            message += `${this.e.user_id}获取米游币异常`;
        }
        return {
            message
        }
    }

    async signTask(e = "", resume = false) {
        let mul = e;
        //暂不支持多个uid签到
        Bot.logger.mark(`开始米社签到任务${resume ? '(恢复中)' : ''}`);
        let isAllSign = this.configSign.isAllSign
        let userIdList = {};
        let dir = './data/MysCookie/'
        if (isV3) {
            if (!fs.existsSync(dir)) {
                let NoteUser = (await import(`file://${_path}/plugins/genshin/model/mys/NoteUser.js`)).default
                await NoteUser.forEach(async (user) => {
                    await user.eachMysUser(async (mys) => {
                        let { qq } = user
                        let { ck, ltuid, device_id } = mys 
                        if (Object.keys(userIdList).includes(qq+'')) {
                            let seed_id = lodash.sample('abcdefghijklmnopqrstuvwxyz', 4).replace(/,/g, '')
                            userIdList[qq + seed_id] = {
                                qq, ck, device_id,
                                ltuid,
                            }
                        } else {
                            userIdList[qq] = {
                                qq, ck, device_id,
                                ltuid,
                            }   
                        }
                    })
                })
            } else {
                userIdList = (await gsCfg.getBingAllCk()).ckQQ
            }
        } else {
            userIdList = NoteCookie;
        }
        
        // 获取已标记的失效账号列表
        let invalidAccountsList = await this.getInvalidAccounts('mys');
        let invalidSet = new Set(); // 用于快速查找失效账号
        if (invalidAccountsList && invalidAccountsList.length > 0) {
            for (let account of invalidAccountsList) {
                invalidSet.add(String(account.userId));
            }
        }
        
        let userIdkeys = Object.keys(userIdList);
        
        // 将用户列表分为未标记和已标记两部分，优先签到未标记的
        let validUsers = [];
        let markedUsers = [];
        for (let qq of userIdkeys) {
            let user_id = qq.replace(/\s+(?:n$)?/gi, '');
            if (invalidSet.has(user_id)) {
                markedUsers.push(qq);
            } else {
                validUsers.push(qq);
            }
        }
        // 合并：未标记的在前，已标记的在后
        userIdkeys = [...validUsers, ...markedUsers];
        if (markedUsers.length > 0) {
            Bot.logger.mark(`[米社签到] 检测到${markedUsers.length}个已标记的失效账号，将优先签到${validUsers.length}个未标记账号`);
        }
        
        let startIndex = 0;
        if (resume) {
            // 恢复任务，获取上次进度
            const progress = await redis.get('xiaoyao:task:progress:mys');
            if (progress) {
                const taskData = JSON.parse(progress);
                const today = moment().format('YYYY-MM-DD');
                if (taskData.date === today && taskData.completedUsers) {
                    startIndex = taskData.completed || 0;
                    // 过滤已完成的用户
                    userIdkeys = userIdkeys.filter(qq => !taskData.completedUsers.includes(qq.replace(/\s+(?:n$)?/gi, '')));
                    Bot.logger.mark(`恢复任务，从第${startIndex + 1}个用户开始，剩余${userIdkeys.length}个`);
                    // 恢复任务后需要重新计算validUsers和markedUsers
                    validUsers = [];
                    markedUsers = [];
                    for (let qq of userIdkeys) {
                        let user_id = qq.replace(/\s+(?:n$)?/gi, '');
                        if (invalidSet.has(user_id)) {
                            markedUsers.push(qq);
                        } else {
                            validUsers.push(qq);
                        }
                    }
                    // 重新合并：未标记的在前，已标记的在后
                    userIdkeys = [...validUsers, ...markedUsers];
                }
            }
        }
        
        if (mysTask && !resume) {
            if (e && e.reply) {
                e.reply(`米社自动签到任务进行中，请勿重复触发指令`)
            }
            return false
        }
        mysTask = true;
        
        let totalUsers = userIdkeys.length + startIndex;
        let tips = ['开始米社签到任务']
        let time = totalUsers * 45 + 5  // 平均45秒一个账号
        let finishTime = moment().add(time, 's').format('MM-DD HH:mm:ss')
        tips.push(`\n签到用户：${totalUsers}个`)
        tips.push(`\n预计需要：${this.countTime(time)}`)
        if (time > 120) {
            tips.push(`\n完成时间：${finishTime}`)
        }
        Bot.logger.mark(`签到用户:${totalUsers}个，预计需要${this.countTime(time)} ${finishTime} 完成`)
        if (mul && e && e.reply) {
            await this.e.reply(tips)
            if (this.e.msg && this.e.msg.includes('force')) this.force = true
            // 如果设置了 sendToMaster 标记，同时发送给主人
            if (e.sendToMaster && !resume) {
                await utils.sendToMaster(tips.join(''))
            }
        } else if (!resume) {
            await utils.sendToMaster(tips.join(''))
            await utils.sleepAsync(lodash.random(1, 20) * 1000)
        }
        let _reply = e && e.reply ? e.reply : () => {};
        let msg = e?.msg;
        
        // 初始化进度
        let savedProgress = null;
        if (resume) {
            const progressData = await redis.get('xiaoyao:task:progress:mys');
            if (progressData) {
                savedProgress = JSON.parse(progressData);
            }
        }
        const completedUsers = resume && savedProgress ? (savedProgress.completedUsers || []) : [];
        await this.saveTaskProgress('mys', {
            startTime: resume && savedProgress ? savedProgress.startTime : Date.now(),
            total: totalUsers,
            completed: startIndex,
            completedUsers: completedUsers,
            current: ''
        });
        
        //暂时先这样吧，等有空再优化~
        this.allSign = {
            findModel: ["崩坏3", "崩坏2", '原神', '未定事件簿', '崩坏星穹铁道'],
            "崩坏3": {
                bindGame: 0,
                sign: 0,
                isSign: 0,
                error: 0,
            },
            "崩坏2": {
                bindGame: 0,
                sign: 0,
                isSign: 0,
                error: 0,
            },
            "原神": {
                bindGame: 0,
                sign: 0,
                isSign: 0,
                error: 0,
            },
            "未定事件簿": {
                bindGame: 0,
                sign: 0,
                isSign: 0,
                error: 0,
            },
            "崩坏星穹铁道": {
                bindGame: 0,
                sign: 0,
                isSign: 0,
                error: 0,
            },
            sendReply() {
                let msg = ""
                for (let item of this.findModel) {
                    msg +=
                        `**${item}**\n已签：${this[item].isSign}\n签到成功：${this[item].sign}\n未绑定信息：${this[item].bindGame}\n签到失败异常：${this[item].error}\n`
                }
                return msg
            }
        }
        // 收集失效账号列表
        let invalidAccounts = [];
        
        // 记录未标记账号的数量（用于完成后发送通知）
        let validUsersCount = validUsers.length;
        let completedValidUsers = 0; // 已完成的未标记账号数
        
        // 在循环开始前检查强制暂停标志（立即停止）
        const forcePaused = await redis.get('xiaoyao:task:forcePause');
        if (forcePaused === '1') {
            Bot.logger.mark(`检测到强制暂停信号，立即停止米社签到任务`);
            mysTask = false;
            // 保存当前进度，以便后续可以恢复
            await this.updateTaskProgress('mys', {
                completed: startIndex,
                completedUsers: [],
                current: ''
            });
            // 标记任务已停止（不立即清除标志，让其他任务也能检测到）
            await redis.set('xiaoyao:task:stopped:mys', '1', { EX: 60 });
            // 立即检查是否所有任务都已停止
            await this.checkAndClearPauseFlags();
            let pauseMsg = `米社签到任务已强制暂停\n已完成：${startIndex}/${totalUsers}\n进度已保存，可后续恢复`;
            if (mul && _reply) {
                _reply(pauseMsg);
            } else {
                await utils.sendToMaster(pauseMsg);
            }
            return;
        }
        
        let counts = startIndex;
        for (let qq of userIdkeys) {
            // 检查是否被强制停止
            const isStopped = await redis.get('xiaoyao:task:stop');
            if (isStopped === '1') {
                Bot.logger.mark(`检测到强制停止信号，停止米社签到任务`);
                mysTask = false;
                // 清除进度
                await this.clearTaskProgress('mys');
                // 保存失效账号（如果有）
                if (invalidAccounts.length > 0) {
                    await this.saveInvalidAccounts('mys', invalidAccounts);
                }
                // 标记任务已停止（不立即清除标志，让其他任务也能检测到）
                await redis.set('xiaoyao:task:stopped:mys', '1', { EX: 60 });
                let stopMsg = `米社签到任务已停止\n已完成：${counts}/${totalUsers}\n进度已清除`;
                if (mul && _reply) {
                    _reply(stopMsg);
                } else {
                    await utils.sendToMaster(stopMsg);
                }
                return;
            }
            
            // 检查是否被强制暂停
            const isPaused = await redis.get('xiaoyao:task:pause');
            if (isPaused === '1') {
                Bot.logger.mark(`检测到强制暂停信号，停止米社签到任务`);
                mysTask = false;
                // 保存当前进度，以便后续可以恢复
                await this.updateTaskProgress('mys', {
                    completed: counts,
                    completedUsers: completedUsers
                });
                // 保存失效账号（如果有）
                if (invalidAccounts.length > 0) {
                    await this.saveInvalidAccounts('mys', invalidAccounts);
                }
                // 标记任务已停止（不立即清除标志，让其他任务也能检测到）
                await redis.set('xiaoyao:task:stopped:mys', '1', { EX: 60 });
                // 立即检查是否所有任务都已停止
                await this.checkAndClearPauseFlags();
                let pauseMsg = `米社签到任务已暂停\n已完成：${counts}/${totalUsers}\n进度已保存，可后续恢复`;
                if (mul && _reply) {
                    _reply(pauseMsg);
                } else {
                    await utils.sendToMaster(pauseMsg);
                }
                return;
            }
            
            let user_id = qq.replace(/\s+(?:n$)?/gi, '');
            let ltuid=userIdList[qq]?.ltuid
            let e = {
                user_id,
                qq: user_id,
                isTask: true,
                uid: userIdList[qq].uid,
                cookie: userIdList[qq].cookie || userIdList[qq].ck,
            };
            if (msg) {
                e.msg = msg.replace(/全部|签到|米社/g, "");
            } else {
                e.msg = "全部"
            }
            counts++;
            Bot.logger.mark(`正在为qq:${user_id},通行证id:${ltuid}米社签到中...`);
            
            // 更新当前处理用户
            await this.updateTaskProgress('mys', {
                current: `QQ ${user_id}`
            });

            this.e = e;
            let res = await this.multiSign(this.getDataList(e.msg));
            
            // 判断是否为标记账号
            let isMarkedUser = invalidSet.has(user_id);
            let isInvalid = false;
            
            // 检查是否失效（-100错误码或消息包含cookie失效/请登录后重试）
            if (res.message && (res.message.includes('cookie失效') || res.message.includes('请登录后重试') || res.message.includes('-100') || (res.ckInvalid === true))) {
                isInvalid = true;
                Bot.logger.mark(`检测到失效账号，标记: QQ${user_id}`);
                invalidAccounts.push({ userId: user_id });
            }
            
            // 如果是标记账号，签到成功则移除标记，失败则保持标记
            if (isMarkedUser) {
                if (!isInvalid) {
                    // 签到成功，移除标记
                    await this.removeInvalidAccount('mys', { userId: user_id });
                    Bot.logger.mark(`标记账号签到成功，已移除标记: QQ${user_id}`);
                } else {
                    // 签到失败，保持标记
                    Bot.logger.mark(`标记账号签到失败，保持标记: QQ${user_id}`);
                }
            }
            
            // 判断是否为未标记账号
            let isValidUser = !isMarkedUser;
            if (isValidUser) {
                completedValidUsers++;
            }
            
            // 更新进度（签到完成后）
            completedUsers.push(user_id);
            await this.updateTaskProgress('mys', {
                completed: counts,
                completedUsers: completedUsers
            });
            
            // 未标记账号全部签到完成时，发送一次完成通知给主人（排除stdin）
            if (isValidUser && completedValidUsers === validUsersCount) {
                await utils.sendToMaster(`米社签到任务完成\n\n未标记账号已全部签到完成（${completedValidUsers}个）`);
                Bot.logger.mark(`[米社签到] 未标记账号签到完成，已通知主人`);
            }
            
            Bot.logger.mark(`${res.message}`)
            e.reply = (msg) => {
                if (!isAllSign || mul) {
                    return;
                }
                if (msg.includes("OK")) {
                    utils.relpyPrivate(user_id, msg + "\n自动签到成功");
                }
            };
            e.reply(res.message)
            this.e.reply(res.message)
            await utils.sleepAsync(15000);
        }
        
        msg = `米社签到任务完成\n` + this.allSign.sendReply();
        // 如果有失效账号，添加到消息中并发送给主人，等待确认删除
        if (invalidAccounts.length > 0) {
            msg += `\n\n检测到${invalidAccounts.length}个失效账号：\n`;
            for (let account of invalidAccounts) {
                msg += `QQ ${account.userId}\n`;
            }
            msg += `\n请发送【#确认删除失效账号】来确认删除这些失效账号`;
            // 保存失效账号到Redis，等待确认
            await this.saveInvalidAccounts('mys', invalidAccounts);
        }
        
        Bot.logger.mark(msg);
        if (mul && _reply) {
            _reply(msg)
            // 如果设置了 sendToMaster 标记，同时发送给主人
            if (e && e.sendToMaster) {
                await utils.sendToMaster(msg)
            }
        } else {
            await utils.sendToMaster(msg)
        }
        
        mysTask = false;
        // 清除暂停标志（如果存在）
        await redis.del('xiaoyao:task:pause');
        await this.clearTaskProgress('mys');
    }

    async cloudTask(e = "") {
        let mul = e;
        Bot.logger.mark(`云原神签到任务开始`);
        let files = fs.readdirSync(this.yunPath).filter(file => file.endsWith('.yaml'))
        if (files.length == 0) return;
        let isCloudSignMsg = this.configSign.isCloudSignMsg
        let userIdList = (files.join(",").replace(/.yaml/g, "").split(","))
        if (cloudTask) {
            e.reply(`云原神自动签到任务进行中，请勿重复触发指令`)
            return false
        }
        let tips = ['开始云原神签到任务']
        let time = userIdList.length * 3.5 + 5
        let finishTime = moment().add(time, 's').format('MM-DD HH:mm:ss')
        tips.push(`\n签到用户：${userIdList.length}个`)
        tips.push(`\n预计需要：${this.countTime(time)}`)
        if (time > 120) {
            tips.push(`\n完成时间：${finishTime}`)
        }
        Bot.logger.mark(`签到用户:${userIdList.length}个，预计需要${this.countTime(time)} ${finishTime} 完成`)
        if (mul) {
            await this.e.reply(tips)
            // 如果设置了 sendToMaster 标记，同时发送给主人
            if (e && e.sendToMaster) {
                await utils.sendToMaster(tips.join(''))
            }
        } else {
            await utils.sendToMaster(tips.join(''))
            await utils.sleepAsync(lodash.random(1, 20) * 1000)
        }
        cloudTask = true;
        let _reply = e.reply
        let counts = 0;
        
        // 在循环开始前检查强制暂停标志（立即停止）
        const forcePaused = await redis.get('xiaoyao:task:forcePause');
        if (forcePaused === '1') {
            Bot.logger.mark(`检测到强制暂停信号，立即停止云原神签到任务`);
            cloudTask = false;
            // 标记任务已停止（不立即清除标志，让其他任务也能检测到）
            await redis.set('xiaoyao:task:stopped:cloud', '1', { EX: 60 });
            // 立即检查是否所有任务都已停止
            await this.checkAndClearPauseFlags();
            let pauseMsg = `云原神签到任务已强制暂停\n已完成：${counts}/${userIdList.length}`;
            if (mul && _reply) {
                _reply(pauseMsg);
            } else {
                await utils.sendToMaster(pauseMsg);
            }
            return;
        }
        
        for (let qq of userIdList) {
            // 检查是否被强制停止
            const isStopped = await redis.get('xiaoyao:task:stop');
            if (isStopped === '1') {
                Bot.logger.mark(`检测到强制停止信号，停止云原神签到任务`);
                cloudTask = false;
                // 标记任务已停止（不立即清除标志，让其他任务也能检测到）
                await redis.set('xiaoyao:task:stopped:cloud', '1', { EX: 60 });
                // 立即检查是否所有任务都已停止
                await this.checkAndClearStopFlags();
                let stopMsg = `云原神签到任务已停止\n已完成：${counts}/${userIdList.length}\n进度已清除`;
                if (mul && _reply) {
                    _reply(stopMsg);
                } else {
                    await utils.sendToMaster(stopMsg);
                }
                return;
            }
            
            // 检查是否被强制暂停
            const isPaused = await redis.get('xiaoyao:task:pause');
            if (isPaused === '1') {
                Bot.logger.mark(`检测到强制暂停信号，停止云原神签到任务`);
                cloudTask = false;
                // 标记任务已停止（不立即清除标志，让其他任务也能检测到）
                await redis.set('xiaoyao:task:stopped:cloud', '1', { EX: 60 });
                // 立即检查是否所有任务都已停止
                await this.checkAndClearPauseFlags();
                let pauseMsg = `云原神签到任务已暂停\n已完成：${counts}/${userIdList.length}`;
                if (mul && _reply) {
                    _reply(pauseMsg);
                } else {
                    await utils.sendToMaster(pauseMsg);
                }
                return;
            }
            
            counts++;
            let user_id = qq;
            let e = {
                user_id,
                qq,
                isTask: true
            };
            Bot.logger.mark(`正在为qq${user_id}云原神签到中...`);
            e.msg = "全部"
            e.reply = (msg) => {
                if (!isCloudSignMsg || mul) {
                    return;
                }
                if (msg.includes("领取奖励")) {
                    utils.relpyPrivate(qq, msg + "\n云原神自动签到成功");
                }
            };
            this.e = e
            await this.getyunToken(e)
            let res = await this.cloudSign();
            this.e.reply(res.message)
            await utils.sleepAsync(10000);
        }
        let msg = `云原神签到任务完成`
        Bot.logger.mark(msg);
        if (mul) {
            _reply(msg)
            // 如果设置了 sendToMaster 标记，同时发送给主人
            if (e && e.sendToMaster) {
                await utils.sendToMaster(msg)
            }
        } else {
            await utils.sendToMaster(msg)
        }
        cloudTask = false;
    }

    countTime(time) {
        let hour = Math.floor((time / 3600) % 24)
        let min = Math.floor((time / 60) % 60)
        let sec = Math.floor(time % 60)
        let msg = ''
        if (hour > 0) msg += `${hour}小时`
        if (min > 0) msg += `${min}分钟`
        if (sec > 0) msg += `${sec}秒`
        return msg
    }

    async bbsTask(e = "", resume = false) {
        let mul = e;
        Bot.logger.mark(`开始米社米币签到任务${resume ? '(恢复中)' : ''}`);
        let stoken = await gsCfg.getBingStoken();
        let isPushSign = this.configSign.isPushSign
        
        // 构建用户列表
        let allUsers = [];
        for (let dataUid of stoken) {
            for (let uuId in dataUid) {
                if (uuId[0] * 1 > 5) {
                    continue;
                }
                let data = dataUid[uuId];
                allUsers.push({
                    userId: data.userId * 1,
                    uid: uuId,
                    data: data
                });
            }
        }
        
        // 获取已标记的失效账号列表
        let invalidAccountsList = await this.getInvalidAccounts('bbs');
        let invalidSet = new Set(); // 用于快速查找失效账号
        if (invalidAccountsList && invalidAccountsList.length > 0) {
            for (let account of invalidAccountsList) {
                let key = `${account.userId}:${account.uid}`;
                invalidSet.add(key);
            }
        }
        
        // 将用户列表分为未标记和已标记两部分，优先签到未标记的
        let validUsers = [];
        let markedUsers = [];
        for (let user of allUsers) {
            let key = `${user.userId}:${user.uid}`;
            if (invalidSet.has(key)) {
                markedUsers.push(user);
            } else {
                validUsers.push(user);
            }
        }
        // 合并：未标记的在前，已标记的在后
        allUsers = [...validUsers, ...markedUsers];
        if (markedUsers.length > 0) {
            Bot.logger.mark(`[米游币签到] 检测到${markedUsers.length}个已标记的失效账号，将优先签到${validUsers.length}个未标记账号`);
        }
        
        let startIndex = 0;
        if (resume) {
            // 恢复任务，获取上次进度
            const progress = await redis.get('xiaoyao:task:progress:bbs');
            if (progress) {
                const taskData = JSON.parse(progress);
                const today = moment().format('YYYY-MM-DD');
                if (taskData.date === today && taskData.completedUsers) {
                    startIndex = taskData.completed || 0;
                    // 过滤已完成的用户
                    allUsers = allUsers.filter(user => !taskData.completedUsers.includes(`${user.userId}:${user.uid}`));
                    Bot.logger.mark(`恢复任务，从第${startIndex + 1}个用户开始，剩余${allUsers.length}个`);
                    // 恢复任务后需要重新计算validUsers和markedUsers
                    validUsers = [];
                    markedUsers = [];
                    for (let user of allUsers) {
                        let key = `${user.userId}:${user.uid}`;
                        if (invalidSet.has(key)) {
                            markedUsers.push(user);
                        } else {
                            validUsers.push(user);
                        }
                    }
                    // 重新合并：未标记的在前，已标记的在后
                    allUsers = [...validUsers, ...markedUsers];
                }
            }
        }
        
        if (bbsTask && !resume) {
            if (e && e.reply) {
                e.reply(`米游币自动签到任务进行中，请勿重复触发指令`)
            }
            return false
        }
        
        let totalUsers = allUsers.length + startIndex;
        let validUsersCount = validUsers.length; // 未标记账号数量
        let markedUsersCount = markedUsers.length; // 已标记账号数量
        let tips = ['开始米游币签到任务']
        let time = totalUsers * 780 + 5  // 780秒一个账号
        let finishTime = moment().add(time, 's').format('MM-DD HH:mm:ss')
        if (markedUsersCount > 0) {
            tips.push(`\n签到用户：${totalUsers}个（未标记：${validUsersCount}个，已标记失效：${markedUsersCount}个）`)
        } else {
            tips.push(`\n签到用户：${totalUsers}个`)
        }
        tips.push(`\n预计需要：${this.countTime(time)}`)
        if (time > 120) {
            tips.push(`\n完成时间：${finishTime}`)
        }
        if (markedUsersCount > 0) {
            Bot.logger.mark(`签到用户:${totalUsers}个（未标记：${validUsersCount}个，已标记失效：${markedUsersCount}个），预计需要${this.countTime(time)} ${finishTime} 完成`)
        } else {
            Bot.logger.mark(`签到用户:${totalUsers}个，预计需要${this.countTime(time)} ${finishTime} 完成`)
        }
        if (mul && e && e.reply) {
            await this.e.reply(tips)
            if (this.e.msg && this.e.msg.includes('force')) this.force = true
            // 如果设置了 sendToMaster 标记，同时发送给主人
            if (e.sendToMaster && !resume) {
                await utils.sendToMaster(tips.join(''))
            }
        } else if (!resume) {
            await utils.sendToMaster(tips.join(''))
            await utils.sleepAsync(lodash.random(1, 20) * 1000)
        }
        bbsTask = true;
        let _reply = e && e.reply ? e.reply : () => {};
        
        // 初始化进度
        let savedProgress = null;
        if (resume) {
            const progressData = await redis.get('xiaoyao:task:progress:bbs');
            if (progressData) {
                savedProgress = JSON.parse(progressData);
            }
        }
        const completedUsers = resume && savedProgress ? (savedProgress.completedUsers || []) : [];
        await this.saveTaskProgress('bbs', {
            startTime: resume && savedProgress ? savedProgress.startTime : Date.now(),
            total: totalUsers,
            completed: startIndex,
            completedUsers: completedUsers,
            current: ''
        });
        
        // 收集失效账号列表
        let invalidAccounts = [];
        
        // 记录未标记账号的数量（用于完成后发送通知）
        let completedValidUsers = 0; // 已完成的未标记账号数
        
        // 在循环开始前检查强制暂停标志（立即停止）
        const forcePaused = await redis.get('xiaoyao:task:forcePause');
        if (forcePaused === '1') {
            Bot.logger.mark(`检测到强制暂停信号，立即停止米游币签到任务`);
            bbsTask = false;
            // 保存当前进度，以便后续可以恢复
            await this.updateTaskProgress('bbs', {
                completed: startIndex,
                completedUsers: [],
                current: ''
            });
            // 标记任务已停止（不立即清除标志，让其他任务也能检测到）
            await redis.set('xiaoyao:task:stopped:bbs', '1', { EX: 60 });
            // 立即检查是否所有任务都已停止
            await this.checkAndClearPauseFlags();
            let pauseMsg = `米游币签到任务已强制暂停\n已完成：${startIndex}/${totalUsers}\n进度已保存，可后续恢复`;
            if (mul && _reply) {
                _reply(pauseMsg);
            } else {
                await utils.sendToMaster(pauseMsg);
            }
            return;
        }
        
        let counts = startIndex;
        //获取需要签到的用户
        for (let userInfo of allUsers) {
            // 检查是否被强制停止
            const isStopped = await redis.get('xiaoyao:task:stop');
            if (isStopped === '1') {
                Bot.logger.mark(`检测到强制停止信号，停止米游币签到任务`);
                bbsTask = false;
                // 清除进度
                await this.clearTaskProgress('bbs');
                // 保存失效账号（如果有）
                if (invalidAccounts.length > 0) {
                    await this.saveInvalidAccounts('bbs', invalidAccounts);
                }
                // 标记任务已停止（不立即清除标志，让其他任务也能检测到）
                await redis.set('xiaoyao:task:stopped:bbs', '1', { EX: 60 });
                // 立即检查是否所有任务都已停止
                await this.checkAndClearStopFlags();
                let stopMsg = `米游币签到任务已停止\n已完成：${counts}/${totalUsers}\n进度已清除`;
                if (mul && _reply) {
                    _reply(stopMsg);
                } else {
                    await utils.sendToMaster(stopMsg);
                }
                return;
            }
            
            // 检查是否被强制暂停
            const isPaused = await redis.get('xiaoyao:task:pause');
            if (isPaused === '1') {
                Bot.logger.mark(`检测到强制暂停信号，停止米游币签到任务`);
                bbsTask = false;
                // 保存当前进度，以便后续可以恢复
                await this.updateTaskProgress('bbs', {
                    completed: counts,
                    completedUsers: completedUsers
                });
                // 保存失效账号（如果有）
                if (invalidAccounts.length > 0) {
                    await this.saveInvalidAccounts('bbs', invalidAccounts);
                }
                // 标记任务已停止（不立即清除标志，让其他任务也能检测到）
                await redis.set('xiaoyao:task:stopped:bbs', '1', { EX: 60 });
                // 立即检查是否所有任务都已停止
                await this.checkAndClearPauseFlags();
                let pauseMsg = `米游币签到任务已暂停\n已完成：${counts}/${totalUsers}\n进度已保存，可后续恢复`;
                if (mul && _reply) {
                    _reply(pauseMsg);
                } else {
                    await utils.sendToMaster(pauseMsg);
                }
                return;
            }
            
            try {
                let user_id = userInfo.userId;
                let uuId = userInfo.uid;
                let data = userInfo.data;
                let e = {
                    user_id,
                    isTask: true
                };
                counts++;
                e.cookie = `stuid=${data.stuid};stoken=${data.stoken};ltoken=${data.ltoken};`;
                Bot.logger.mark(`[米游币签到][第${counts}个]正在为qq${user_id}：uid:${uuId}签到中...`);
                
                e.msg = "全部"
                e.reply = (msg) => {
                    //关闭签到消息推送
                    if (!isPushSign || mul) {
                        return;
                    }
                    if (msg.includes("OK")) { //签到成功并且不是已签到的才推送
                        utils.relpyPrivate(user_id, msg + "uid:" + uuId + "\n自动签到成功");
                    }
                };
                this.e = e;
                
                // 更新当前处理用户
                await this.updateTaskProgress('bbs', {
                    current: `QQ ${user_id} (uid:${uuId})`
                });
                
                //await 代表同步 你可以尝试去除await以进行优化速度
                let res = await this.getbbsSign(this.ForumData);
                
                // 判断是否为标记账号
                let accountKey = `${user_id}:${uuId}`;
                let isMarkedUser = invalidSet.has(accountKey);
                let isInvalid = false;
                
                // 检查是否失效（-100错误码或消息包含登录失效/请登录后重试）
                if (res && (res.ckInvalid === true || res.message && (res.message.includes('登录失效') || res.message.includes('请登录后重试') || res.message.includes('-100')))) {
                    isInvalid = true;
                    Bot.logger.mark(`检测到失效账号，标记: QQ${user_id} UID${uuId}`);
                    invalidAccounts.push({ userId: user_id, uid: uuId });
                }
                
                // 如果是标记账号，签到成功则移除标记，失败则保持标记
                if (isMarkedUser) {
                    if (!isInvalid) {
                        // 签到成功，移除标记
                        await this.removeInvalidAccount('bbs', { userId: user_id, uid: uuId });
                        Bot.logger.mark(`标记账号签到成功，已移除标记: QQ${user_id} UID${uuId}`);
                    } else {
                        // 签到失败，保持标记
                        Bot.logger.mark(`标记账号签到失败，保持标记: QQ${user_id} UID${uuId}`);
                    }
                }
                
                // 判断是否为未标记账号
                let isValidUser = !isMarkedUser;
                if (isValidUser) {
                    completedValidUsers++;
                }
                
                // 更新进度（签到完成后）
                completedUsers.push(accountKey);
                await this.updateTaskProgress('bbs', {
                    completed: counts,
                    completedUsers: completedUsers
                });
                
                // 未标记账号全部签到完成时，发送一次完成通知给主人（排除stdin）
                if (isValidUser && completedValidUsers === validUsersCount) {
                    await utils.sendToMaster(`米游币签到任务完成\n\n未标记账号已全部签到完成（${completedValidUsers}个）`);
                    Bot.logger.mark(`[米游币签到] 未标记账号签到完成，已通知主人`);
                }
                
                e.reply(res.message)
                await utils.sleepAsync(10000); // 10秒延迟，实际签到耗时已在getbbsSign中
            } catch (error) {
                logger.error(`米游币签到报错：` + error)
            }
        }
        
        let msg = `米社米币签到任务完成`;
        // 如果有失效账号，添加到消息中并发送给主人，等待确认删除
        if (invalidAccounts.length > 0) {
            msg += `\n\n检测到${invalidAccounts.length}个失效账号：\n`;
            for (let account of invalidAccounts) {
                msg += `QQ ${account.userId} (UID: ${account.uid})\n`;
            }
            msg += `\n请发送【#确认删除失效账号】来确认删除这些失效账号`;
            // 保存失效账号到Redis，等待确认
            await this.saveInvalidAccounts('bbs', invalidAccounts);
        }
        
        Bot.logger.mark(msg);
        if (mul && _reply) {
            _reply(msg)
            // 如果设置了 sendToMaster 标记，同时发送给主人
            if (e && e.sendToMaster) {
                await utils.sendToMaster(msg)
            }
        } else {
            await utils.sendToMaster(msg)
        }
        
        bbsTask = false;
        // 清除暂停标志（如果存在）
        await redis.del('xiaoyao:task:pause');
        await this.clearTaskProgress('bbs');
    }

    async bbsGeetest() {
        if (!this.getToken) return ""
        try {
            let res = await this.getData('bbsGetCaptcha', false)
            // let challenge = res.data["challenge"]
            // await this.getData("geeType", res.data, false)
            res.data.getToken = this.getToken
            res = await this.getData("validate", res.data, false)
            if (res?.data?.validate) {
                res = await this.getData("bbsCaptchaVerify", res.data, false)
                return res["data"]["challenge"]
            }
        } catch (error) {
            //大概率是数据空导致报错这种情况很少见捏，所以你可以忽略不看
            Bot.logger.error('[validate][接口请求]异常信息：' + error)
            return ""
        }
        return ""
    }

    async geetest(data) {
        if (!this.getToken) return ""
        try {
            data.getToken = this.getToken
            let res = await this.getData("validate", data, false)
            if (res?.data?.validate) {
                let validate = res?.data?.validate
                return validate
            }
        } catch (error) {
            //大概率是数据空导致报错这种情况很少见捏，所以你可以忽略不看
            Bot.logger.error('[validate][接口请求]异常信息：' + error)
            return ""
        }
        return ""
    }

    getyunToken(e) {
        let file = `${this.yunPath}${e.user_id}.yaml`
        try {
            let ck = fs.readFileSync(file, 'utf-8')
            ck = YAML.parse(ck)
            this.e.devId = ck.devId;
            this.e.yuntoken = ck.yuntoken;
            return ck
        } catch (error) {
            return ""
        }
    }

    async cookie(e) {
        let {
            cookie,
            uid,
            skuid
        } = await this.getCookie(e);
        let cookiesDoc = await this.getcookiesDoc();
        if (!cookie) {
            return false;
        }
        let stokens = this.getStoken(e.user_id)
        if (!stokens) {
            return true;
        }
        if (!cookie.includes("login_ticket") && (isV3 && !skuid?.login_ticket)) {
            return false;
        }
        let flot = await this.stoken(cookie, e)
        await utils.sleepAsync(1000); //延迟加载防止文件未生成
        if (!flot) {
            return false;
        }
        return true;
    }

    async getcookiesDoc() {
        return await gsCfg.getfileYaml(`${_path}/plugins/xiaoyao-cvs-plugin/config/`, "config").cookiesDoc
    }

    async getCookie(e) {
        let skuid, cookie, uid
        if (isV3) {
            skuid = await gsCfg.getBingCookie(e.user_id); 
            cookie = skuid?.ck;
            uid = skuid?.item;
            if (!uid && e?.user?.getUid) {
                uid = e?.user?.getUid('gs')
                cookie = e?.user?.mysUser?.ck
            }
            // if (!uid && e.user) { //获取uid为空时进行后续处理获取 (临时处理方式后续会进行解耦以避免这种情况。。待咕中.)s
            // }
        } else {
            if (NoteCookie[e.user_id]) {
                cookie = NoteCookie[e.user_id].cookie;
                uid = NoteCookie[e.user_id].uid;
                skuid = NoteCookie[e.user_id];
            } else if (BotConfig.dailyNote && BotConfig.dailyNote[e.user_id]) {
                cookie = BotConfig.dailyNote[e.user_id].cookie;
                uid = BotConfig.dailyNote[e.user_id].uid;
                skuid = BotConfig.NoteCookie[e.user_id];
            }
        }
        if (!uid) {
            uid = e.runtime?.user?._regUid
        }
        this.e.uid = uid;
        this.e.cookie = cookie;
        return {
            cookie,
            uid,
            skuid
        }
    }

    async stoken(cookie, e) {
        this.e = e;
        let datalist = this.getStoken(e.user_id) || {}
        if (Object.keys(datalist).length > 0) {
            return true;
        }
        const map = await utils.getCookieMap(cookie);
        let loginTicket = map?.get("login_ticket");
        const loginUid = map?.get("login_uid") ? map?.get("login_uid") : map?.get("ltuid");
        if (isV3) {
            loginTicket = gsCfg.getBingCookie(e.user_id).login_ticket
        }
        let mhyapi = new miHoYoApi(this.e);
        let res = await mhyapi.getData("bbsStoken", {
            loginUid,
            loginTicket
        }, false)
        if (res?.data) {
            datalist[e.uid] = {
                stuid: map?.get("account_id"),
                stoken: res.data.list[0].token,
                ltoken: res.data.list[1].token,
                uid: e.uid,
                userId: e.user_id,
                is_sign: true
            }
            gsCfg.saveBingStoken(e.user_id, datalist)
        }
        return true;
    }

    getStoken(userId) {
        let file = `${yamlDataUrl}/${userId}.yaml`
        try {
            let ck = fs.readFileSync(file, 'utf-8')
            ck = YAML.parse(ck)
            if (ck?.uid) {
                let datalist = {};
                ck.userId = this.e.user_id
                datalist[ck.uid] = ck;
                ck = datalist
                gsCfg.saveBingStoken(this.e.user_id, datalist)
            }
            return ck[this.e.uid] || {}
        } catch (error) {
            return {}
        }
    }

    async seachUid(data) {
        let ltoken = '', v2Sk;
        if (data?.data) {
            let res;
            if (this.e.sk) {
                if (this.e.sk.get('stoken').includes('v2_')) {
                    res = await this.getData('getLtoken', { cookies: this.e.raw_message }, false)
                    ltoken = res?.data?.ltoken
                } else {
                    v2Sk = await this.getData('getByStokenV2', { headers: { Cookie: this.e.raw_message } }, false)
                }
                this.e.cookie =
                    `ltoken=${this.e.sk?.get('ltoken') || ltoken};ltuid=${this.e.sk?.get('stuid')};cookie_token=${data.data.cookie_token}; account_id=${this.e.sk?.get('stuid')};`
                // if(this.e.sk?.get('mid')){
                // 	this.e.cookie =
                // 		`ltoken_v2=${this.e.sk?.get('ltoken')||ltoken};cookie_token_v2=${data.data.cookie_token}; account_mid_v2=${this.e.sk.get('mid')};ltmid_v2=${this.e.sk.get('mid')}`
                // }
            } else {
                this.e.cookie = this.e.original_msg //发送的为cookies
                this.cookies = `stuid=${this.e.stuid};stoken=${data?.data?.list[0].token};ltoken=${data?.data?.list[1].token}`
                res = await this.getData('getLtoken', { cookies: this.cookies }, false)
                v2Sk = await this.getData('getByStokenV2', { headers: { Cookie: this.cookies } }, false)
            }
            let list = []
            for (let item of ['崩坏星穹铁道', '原神']) {
                let result = await this.getData("userGameInfo", this.getDataList(item)[0], false)
                if (result?.retcode != 0) {
                    continue;
                }
                list.push(...result?.data?.list)
            }
            if (list.length == 0) return false;
            let uids = []
            for (let s of list) {
                let datalist = {}
                let uid = s.game_uid
                uids.push(s.region_name + ':' + uid)
                datalist[uid] = {
                    stuid: this.e?.sk?.get('stuid') || this.e.stuid,
                    stoken: v2Sk?.data?.token?.token || this.e?.sk?.get('stoken') || data?.data?.list[0].token,
                    ltoken: this.e?.sk?.get('ltoken') || ltoken || data?.data?.list[1].token,
                    mid: this.e?.sk?.get('mid') || v2Sk?.data?.user_info?.mid,
                    uid: uid,
                    userId: this.e.user_id,
                    is_sign: true,
                    region_name: s.region_name,
                    region: s.region
                }
                await gsCfg.saveBingStoken(this.e.user_id, datalist)
            }
            let msg = `${uids.join('\n')}\nstoken绑定成功您可通过下列指令进行操作:`;
            msg += '\n【#米币查询】查询米游币余额'
            msg += '\n【#mys原神签到】获取米游币'
            msg += '\n【#更新抽卡记录】更新抽卡记录'
            msg += '\n【#刷新ck】刷新失效cookie'
            msg += '\n【#我的stoken】查看绑定信息'
            msg += '\n【#删除stoken】删除绑定信息'
            this.e.reply(msg)
        }
    }

    async delSytk(path = yamlDataUrl, e, type = "stoken") {
        await this.getCookie(e);
        if (type != "stoken") {
            path = cloudDataUrl
        }
        let file = `${path}/${e.user_id}.yaml`
        fs.exists(file, (exists) => {
            if (!exists) {
                return true;
            }
            let ck = fs.readFileSync(file, 'utf-8')
            ck = YAML.parse(ck)
            if (ck?.yuntoken) {
                fs.unlinkSync(file);
            } else if (ck) {
                if (!ck[e.uid]) {
                    return true;
                }
                let sk=ck[e.uid]
                lodash.forEach(ck,(v,i)=>{
                    if(sk?.stoken===v?.stoken){
                        delete ck[i];
                    }
                })
                if (Object.keys(ck) == 0) {
                    fs.unlinkSync(file);
                } else {
                    ck = YAML.stringify(ck)
                    fs.writeFileSync(file, ck, 'utf8')
                }
            }
            e.reply(`已删除${/米游社|mys|米币|米游币|sk|stoken/.test(e.msg)?'stoken':'云原神token'}`)
            return true;
        })
    }

    getDataList(name) {
        let otherName = lodash.map(this.ForumData, 'otherName')
        for (let [index, item] of Object.entries(otherName)) {
            if (item.includes(name)) { //循环结束未找到的时候返回原数组签到全部
                return [this.ForumData[index]]
            }
        }
        return this.ForumData;
    }

    // 进度管理方法
    async saveTaskProgress(taskType, data) {
        const key = `xiaoyao:task:progress:${taskType}`;
        const today = moment().format('YYYY-MM-DD');
        data.date = today;
        await redis.set(key, JSON.stringify(data), { EX: 86400 * 2 }); // 保存2天
    }

    async getTaskProgress() {
        const tasks = ['bbs', 'mys', 'cloud'];
        const progress = {};
        for (let taskType of tasks) {
            const key = `xiaoyao:task:progress:${taskType}`;
            const data = await redis.get(key);
            if (data) {
                const taskData = JSON.parse(data);
                const today = moment().format('YYYY-MM-DD');
                // 只返回今天的数据
                if (taskData.date === today) {
                    progress[taskType] = taskData;
                } else {
                    await redis.del(key);
                }
            }
        }
        return progress;
    }

    async clearTaskProgress(taskType) {
        const key = `xiaoyao:task:progress:${taskType}`;
        await redis.del(key);
    }

    async updateTaskProgress(taskType, updateData) {
        const key = `xiaoyao:task:progress:${taskType}`;
        const data = await redis.get(key);
        if (data) {
            const taskData = JSON.parse(data);
            Object.assign(taskData, updateData);
            await redis.set(key, JSON.stringify(taskData), { EX: 86400 * 2 });
            return taskData;
        }
        return null;
    }

    // 删除失效的stoken账号
    async removeInvalidStoken(userId, uid) {
        try {
            const file = `./plugins/${plugin}/data/yaml/${userId}.yaml`;
            if (!fs.existsSync(file)) {
                Bot.logger.mark(`文件不存在，跳过删除: QQ${userId} UID${uid}`);
                return;
            }
            const stokenData = await gsCfg.getUserStoken(userId);
            if (stokenData && stokenData[uid]) {
                delete stokenData[uid];
                if (Object.keys(stokenData).length === 0) {
                    // 如果没有其他uid，删除整个文件
                    fs.unlinkSync(file);
                } else {
                    gsCfg.saveBingStoken(userId, stokenData);
                }
                Bot.logger.mark(`已移除失效stoken: QQ${userId} UID${uid}`);
            }
        } catch (error) {
            Bot.logger.error(`移除失效stoken失败: ${error}`);
        }
    }

    // 删除失效的云原神账号
    async removeInvalidCloudToken(userId) {
        try {
            const file = `${this.yunPath}${userId}.yaml`;
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
                Bot.logger.mark(`已移除失效云原神token: QQ${userId}`);
            }
        } catch (error) {
            Bot.logger.error(`移除失效云原神token失败: ${error}`);
        }
    }

    // 删除失效的米社cookie账号
    async removeInvalidMysCookie(userId) {
        try {
            const dir = './data/MysCookie/';
            const file = `${dir}${userId}.yaml`;
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
                Bot.logger.mark(`已移除失效米社cookie: QQ${userId}`);
            }
        } catch (error) {
            Bot.logger.error(`移除失效米社cookie失败: ${error}`);
        }
    }

    // 保存失效账号列表到Redis，等待确认删除
    async saveInvalidAccounts(taskType, accounts) {
        const key = `xiaoyao:invalid:accounts:${taskType}`;
        await redis.set(key, JSON.stringify(accounts), { EX: 86400 * 7 }); // 保存7天
    }

    // 获取失效账号列表
    async getInvalidAccounts(taskType) {
        const key = `xiaoyao:invalid:accounts:${taskType}`;
        const data = await redis.get(key);
        if (data) {
            return JSON.parse(data);
        }
        return [];
    }

    // 移除单个失效账号标记
    async removeInvalidAccount(taskType, account) {
        try {
            const invalidAccounts = await this.getInvalidAccounts(taskType);
            if (invalidAccounts.length === 0) {
                return;
            }
            
            // 根据taskType和account结构来匹配并移除
            const filteredAccounts = invalidAccounts.filter(item => {
                if (taskType === 'bbs') {
                    // bbs类型：{ userId, uid }
                    return !(item.userId === account.userId && item.uid === account.uid);
                } else {
                    // mys类型：{ userId }
                    return !(item.userId === account.userId);
                }
            });
            
            // 如果列表有变化，更新Redis
            if (filteredAccounts.length !== invalidAccounts.length) {
                const key = `xiaoyao:invalid:accounts:${taskType}`;
                if (filteredAccounts.length === 0) {
                    await redis.del(key);
                } else {
                    await redis.set(key, JSON.stringify(filteredAccounts), { EX: 86400 * 7 });
                }
                Bot.logger.mark(`已移除失效账号标记: ${taskType} - ${JSON.stringify(account)}`);
            }
        } catch (error) {
            Bot.logger.error(`移除失效账号标记失败: ${error}`);
        }
    }

    // 检查并清除暂停标志（当任务停止时立即调用）
    async checkAndClearPauseFlags() {
        try {
            const runningTasksStr = await redis.get('xiaoyao:task:running');
            if (!runningTasksStr) {
                // 如果没有运行中的任务记录，直接清除标志
                await redis.del('xiaoyao:task:forcePause');
                await redis.del('xiaoyao:task:pause');
                return;
            }
            
            const savedRunningTasks = JSON.parse(runningTasksStr);
            const stoppedBbs = await redis.get('xiaoyao:task:stopped:bbs');
            const stoppedMys = await redis.get('xiaoyao:task:stopped:mys');
            const stoppedCloud = await redis.get('xiaoyao:task:stopped:cloud');
            
            // 如果所有运行中的任务都已停止，清除暂停标志
            let allStopped = true;
            if (savedRunningTasks.includes('米游币签到') && !stoppedBbs) allStopped = false;
            if (savedRunningTasks.includes('米社签到') && !stoppedMys) allStopped = false;
            if (savedRunningTasks.includes('云原神签到') && !stoppedCloud) allStopped = false;
            
            if (allStopped) {
                await redis.del('xiaoyao:task:forcePause');
                await redis.del('xiaoyao:task:pause');
                await redis.del('xiaoyao:task:stopped:bbs');
                await redis.del('xiaoyao:task:stopped:mys');
                await redis.del('xiaoyao:task:stopped:cloud');
                await redis.del('xiaoyao:task:running');
                Bot.logger.mark('所有签到任务已停止，已立即清除暂停标志');
            }
        } catch (error) {
            Bot.logger.error(`检查并清除暂停标志失败: ${error}`);
        }
    }

    // 检查并清除停止标志（当任务停止时立即调用）
    async checkAndClearStopFlags() {
        try {
            const runningTasksStr = await redis.get('xiaoyao:task:running:stop');
            if (!runningTasksStr) {
                // 如果没有运行中的任务记录，直接清除标志
                await redis.del('xiaoyao:task:stop');
                return;
            }
            
            const savedRunningTasks = JSON.parse(runningTasksStr);
            const stoppedBbs = await redis.get('xiaoyao:task:stopped:bbs');
            const stoppedMys = await redis.get('xiaoyao:task:stopped:mys');
            const stoppedCloud = await redis.get('xiaoyao:task:stopped:cloud');
            
            // 如果所有运行中的任务都已停止，清除停止标志
            let allStopped = true;
            if (savedRunningTasks.includes('米游币签到') && !stoppedBbs) allStopped = false;
            if (savedRunningTasks.includes('米社签到') && !stoppedMys) allStopped = false;
            if (savedRunningTasks.includes('云原神签到') && !stoppedCloud) allStopped = false;
            
            if (allStopped) {
                await redis.del('xiaoyao:task:stop');
                await redis.del('xiaoyao:task:stopped:bbs');
                await redis.del('xiaoyao:task:stopped:mys');
                await redis.del('xiaoyao:task:stopped:cloud');
                await redis.del('xiaoyao:task:running:stop');
                Bot.logger.mark('所有签到任务已停止，已立即清除停止标志');
            }
        } catch (error) {
            Bot.logger.error(`检查并清除停止标志失败: ${error}`);
        }
    }

    // 确认删除失效账号
    async confirmDeleteInvalidAccounts() {
        const tasks = ['bbs', 'mys'];
        let allInvalidAccounts = [];
        let deletedCount = 0;

        for (let taskType of tasks) {
            const invalidAccounts = await this.getInvalidAccounts(taskType);
            if (invalidAccounts.length > 0) {
                allInvalidAccounts.push({ taskType, accounts: invalidAccounts });
                
                // 删除失效账号
                for (let account of invalidAccounts) {
                    try {
                        if (taskType === 'bbs') {
                            await this.removeInvalidStoken(account.userId, account.uid);
                        } else if (taskType === 'mys') {
                            await this.removeInvalidMysCookie(account.userId);
                        }
                        deletedCount++;
                    } catch (error) {
                        Bot.logger.error(`删除失效账号失败: ${error}`);
                    }
                }
                
                // 清除已处理的失效账号列表
                const key = `xiaoyao:invalid:accounts:${taskType}`;
                await redis.del(key);
            }
        }

        if (allInvalidAccounts.length === 0) {
            return '当前没有待删除的失效账号';
        }

        let msg = `已删除${deletedCount}个失效账号：\n\n`;
        for (let item of allInvalidAccounts) {
            const taskName = item.taskType === 'bbs' ? '米游币' : '米社';
            msg += `【${taskName}签到】\n`;
            for (let account of item.accounts) {
                if (account.uid) {
                    msg += `QQ ${account.userId} (UID: ${account.uid})\n`;
                } else {
                    msg += `QQ ${account.userId}\n`;
                }
            }
            msg += `\n`;
        }

        return msg;
    }

    // 强制暂停签到任务
    async forcePauseSignTasks() {
        // 设置强制暂停标志（立即停止但保留进度）
        await redis.set('xiaoyao:task:forcePause', '1', { EX: 86400 * 7 }); // 保存7天
        // 同时设置普通暂停标志，用于循环中的检查
        await redis.set('xiaoyao:task:pause', '1', { EX: 86400 * 7 }); // 保存7天
        // 清除之前的停止标记
        await redis.del('xiaoyao:task:stopped:bbs');
        await redis.del('xiaoyao:task:stopped:mys');
        await redis.del('xiaoyao:task:stopped:cloud');
        
        // 通过检查进度数据来判断任务是否在运行（更准确）
        let runningTasks = [];
        const today = moment().format('YYYY-MM-DD');
        
        // 检查米游币签到任务
        const bbsProgress = await redis.get('xiaoyao:task:progress:bbs');
        if (bbsProgress) {
            const bbsData = JSON.parse(bbsProgress);
            if (bbsData.date === today && bbsData.completed < bbsData.total) {
                runningTasks.push('米游币签到');
            }
        } else if (bbsTask) {
            // 如果没有进度数据但变量为true，也认为在运行
            runningTasks.push('米游币签到');
        }
        
        // 检查米社签到任务
        const mysProgress = await redis.get('xiaoyao:task:progress:mys');
        if (mysProgress) {
            const mysData = JSON.parse(mysProgress);
            if (mysData.date === today && mysData.completed < mysData.total) {
                runningTasks.push('米社签到');
            }
        } else if (mysTask) {
            // 如果没有进度数据但变量为true，也认为在运行
            runningTasks.push('米社签到');
        }
        
        // 检查云原神签到任务（云原神没有进度数据，使用变量判断）
        if (cloudTask) {
            runningTasks.push('云原神签到');
        }

        if (runningTasks.length === 0) {
            return '当前没有正在运行的签到任务';
        }

        Bot.logger.mark(`强制暂停签到任务: ${runningTasks.join(', ')}`);
        
        // 保存运行中的任务列表到Redis，用于后续检查
        await redis.set('xiaoyao:task:running', JSON.stringify(runningTasks), { EX: 60 });
        
        // 延迟检查所有任务是否都已停止，然后清除标志（使用重试机制）
        const checkAndClear = async (retryCount = 0) => {
            const runningTasksStr = await redis.get('xiaoyao:task:running');
            if (!runningTasksStr) {
                // 如果没有运行中的任务记录，直接清除标志（可能是所有任务都已停止）
                await redis.del('xiaoyao:task:forcePause');
                await redis.del('xiaoyao:task:pause');
                Bot.logger.mark('没有运行中的任务记录，已清除暂停标志');
                return;
            }
            
            const savedRunningTasks = JSON.parse(runningTasksStr);
            const stoppedBbs = await redis.get('xiaoyao:task:stopped:bbs');
            const stoppedMys = await redis.get('xiaoyao:task:stopped:mys');
            const stoppedCloud = await redis.get('xiaoyao:task:stopped:cloud');
            
            Bot.logger.mark(`[暂停检查] 运行中任务: ${savedRunningTasks.join(', ')}, 已停止: bbs=${!!stoppedBbs}, mys=${!!stoppedMys}, cloud=${!!stoppedCloud}`);
            
            // 如果所有运行中的任务都已停止，清除暂停标志
            let allStopped = true;
            if (savedRunningTasks.includes('米游币签到') && !stoppedBbs) {
                allStopped = false;
                Bot.logger.mark('[暂停检查] 米游币签到任务尚未停止');
            }
            if (savedRunningTasks.includes('米社签到') && !stoppedMys) {
                allStopped = false;
                Bot.logger.mark('[暂停检查] 米社签到任务尚未停止');
            }
            if (savedRunningTasks.includes('云原神签到') && !stoppedCloud) {
                allStopped = false;
                Bot.logger.mark('[暂停检查] 云原神签到任务尚未停止');
            }
            
            if (allStopped) {
                await redis.del('xiaoyao:task:forcePause');
                await redis.del('xiaoyao:task:pause');
                await redis.del('xiaoyao:task:stopped:bbs');
                await redis.del('xiaoyao:task:stopped:mys');
                await redis.del('xiaoyao:task:stopped:cloud');
                await redis.del('xiaoyao:task:running');
                Bot.logger.mark('所有签到任务已停止，已清除暂停标志');
            } else if (retryCount < 5) {
                // 如果还有任务未停止，且重试次数未达上限，继续重试
                setTimeout(() => checkAndClear(retryCount + 1), 2000);
            } else {
                // 达到重试上限，强制清除标志（避免标志一直存在）
                Bot.logger.warn('达到重试上限，强制清除暂停标志');
                await redis.del('xiaoyao:task:forcePause');
                await redis.del('xiaoyao:task:pause');
                await redis.del('xiaoyao:task:stopped:bbs');
                await redis.del('xiaoyao:task:stopped:mys');
                await redis.del('xiaoyao:task:stopped:cloud');
                await redis.del('xiaoyao:task:running');
            }
        };
        
        setTimeout(() => checkAndClear(0), 2000); // 延迟2秒开始检查
        
        return `已发送强制暂停信号\n当前正在运行的任务：${runningTasks.join('、')}\n任务将立即停止并保存进度`;
    }

    // 停止签到任务（清除进度，无法恢复）
    async stopSignTasks() {
        // 设置停止标志
        await redis.set('xiaoyao:task:stop', '1', { EX: 86400 * 7 }); // 保存7天
        // 清除之前的停止标记
        await redis.del('xiaoyao:task:stopped:bbs');
        await redis.del('xiaoyao:task:stopped:mys');
        await redis.del('xiaoyao:task:stopped:cloud');
        
        // 通过检查进度数据来判断任务是否在运行（更准确）
        let runningTasks = [];
        const today = moment().format('YYYY-MM-DD');
        
        // 检查米游币签到任务
        const bbsProgress = await redis.get('xiaoyao:task:progress:bbs');
        if (bbsProgress) {
            const bbsData = JSON.parse(bbsProgress);
            if (bbsData.date === today && bbsData.completed < bbsData.total) {
                runningTasks.push('米游币签到');
            }
        } else if (bbsTask) {
            // 如果没有进度数据但变量为true，也认为在运行
            runningTasks.push('米游币签到');
        }
        
        // 检查米社签到任务
        const mysProgress = await redis.get('xiaoyao:task:progress:mys');
        if (mysProgress) {
            const mysData = JSON.parse(mysProgress);
            if (mysData.date === today && mysData.completed < mysData.total) {
                runningTasks.push('米社签到');
            }
        } else if (mysTask) {
            // 如果没有进度数据但变量为true，也认为在运行
            runningTasks.push('米社签到');
        }
        
        // 检查云原神签到任务（云原神没有进度数据，使用变量判断）
        if (cloudTask) {
            runningTasks.push('云原神签到');
        }

        if (runningTasks.length === 0) {
            return '当前没有正在运行的签到任务';
        }

        Bot.logger.mark(`停止签到任务: ${runningTasks.join(', ')}`);
        
        // 保存运行中的任务列表到Redis，用于后续检查
        await redis.set('xiaoyao:task:running:stop', JSON.stringify(runningTasks), { EX: 60 });
        
        // 延迟检查所有任务是否都已停止，然后清除标志（使用重试机制）
        const checkAndClear = async (retryCount = 0) => {
            const runningTasksStr = await redis.get('xiaoyao:task:running:stop');
            if (!runningTasksStr) {
                // 如果没有运行中的任务记录，直接清除标志（可能是所有任务都已停止）
                await redis.del('xiaoyao:task:stop');
                Bot.logger.mark('没有运行中的任务记录，已清除停止标志');
                return;
            }
            
            const savedRunningTasks = JSON.parse(runningTasksStr);
            const stoppedBbs = await redis.get('xiaoyao:task:stopped:bbs');
            const stoppedMys = await redis.get('xiaoyao:task:stopped:mys');
            const stoppedCloud = await redis.get('xiaoyao:task:stopped:cloud');
            
            Bot.logger.mark(`[停止检查] 运行中任务: ${savedRunningTasks.join(', ')}, 已停止: bbs=${!!stoppedBbs}, mys=${!!stoppedMys}, cloud=${!!stoppedCloud}`);
            
            // 如果所有运行中的任务都已停止，清除停止标志
            let allStopped = true;
            if (savedRunningTasks.includes('米游币签到') && !stoppedBbs) {
                allStopped = false;
                Bot.logger.mark('[停止检查] 米游币签到任务尚未停止');
            }
            if (savedRunningTasks.includes('米社签到') && !stoppedMys) {
                allStopped = false;
                Bot.logger.mark('[停止检查] 米社签到任务尚未停止');
            }
            if (savedRunningTasks.includes('云原神签到') && !stoppedCloud) {
                allStopped = false;
                Bot.logger.mark('[停止检查] 云原神签到任务尚未停止');
            }
            
            if (allStopped) {
                await redis.del('xiaoyao:task:stop');
                await redis.del('xiaoyao:task:stopped:bbs');
                await redis.del('xiaoyao:task:stopped:mys');
                await redis.del('xiaoyao:task:stopped:cloud');
                await redis.del('xiaoyao:task:running:stop');
                Bot.logger.mark('所有签到任务已停止，已清除停止标志');
            } else if (retryCount < 5) {
                // 如果还有任务未停止，且重试次数未达上限，继续重试
                setTimeout(() => checkAndClear(retryCount + 1), 2000);
            } else {
                // 达到重试上限，强制清除标志（避免标志一直存在）
                Bot.logger.warn('达到重试上限，强制清除停止标志');
                await redis.del('xiaoyao:task:stop');
                await redis.del('xiaoyao:task:stopped:bbs');
                await redis.del('xiaoyao:task:stopped:mys');
                await redis.del('xiaoyao:task:stopped:cloud');
                await redis.del('xiaoyao:task:running:stop');
            }
        };
        
        setTimeout(() => checkAndClear(0), 2000); // 延迟2秒开始检查
        
        return `已发送停止信号\n当前正在运行的任务：${runningTasks.join('、')}\n任务将在下一个用户签到完成后停止并清除进度`;
    }

    // 恢复签到任务
    async resumeSignTasks() {
        const tasks = ['bbs', 'mys'];
        let resumedTasks = [];
        
        for (let taskType of tasks) {
            const progressKey = `xiaoyao:task:progress:${taskType}`;
            const progress = await redis.get(progressKey);
            if (progress) {
                const taskData = JSON.parse(progress);
                const today = moment().format('YYYY-MM-DD');
                // 只恢复今天的数据
                if (taskData.date === today && taskData.completed < taskData.total) {
                    resumedTasks.push({ taskType, taskData });
                } else if (taskData.date !== today) {
                    // 不是今天的数据，清理
                    await redis.del(progressKey);
                }
            }
        }
        
        if (resumedTasks.length === 0) {
            return '当前没有可恢复的签到任务';
        }
        
        // 恢复任务
        for (let item of resumedTasks) {
            try {
                if (item.taskType === 'bbs') {
                    // 检查是否正在运行
                    if (bbsTask) {
                        return '米游币签到任务正在运行中，无法恢复';
                    }
                    Bot.logger.mark(`恢复米游币签到任务`);
                    this.bbsTask('', true);
                    resumedTasks[resumedTasks.indexOf(item)].status = '恢复中';
                } else if (item.taskType === 'mys') {
                    // 检查是否正在运行
                    if (mysTask) {
                        return '米社签到任务正在运行中，无法恢复';
                    }
                    Bot.logger.mark(`恢复米社签到任务`);
                    this.signTask('', true);
                    resumedTasks[resumedTasks.indexOf(item)].status = '恢复中';
                }
            } catch (error) {
                Bot.logger.error(`恢复${item.taskType}任务失败: ${error}`);
                resumedTasks[resumedTasks.indexOf(item)].status = `恢复失败: ${error.message}`;
            }
        }
        
        let msg = `正在恢复签到任务：\n\n`;
        for (let item of resumedTasks) {
            const taskName = item.taskType === 'bbs' ? '米游币签到' : '米社签到';
            const progress = item.taskData;
            msg += `【${taskName}】\n`;
            msg += `进度：${progress.completed}/${progress.total}\n`;
            msg += `状态：${item.status || '恢复中'}\n\n`;
        }
        
        return msg;
    }

    // 获取米游币签到用户列表（返回合并转发消息数组）
    async getBbsSignList() {
        try {
            let stoken = await gsCfg.getBingStoken();
            let userList = [];
            let userMap = new Map(); // 用于去重和统计
            
            // 获取失效账号列表
            let invalidAccounts = await this.getInvalidAccounts('bbs');
            let invalidSet = new Set(); // 用于快速查找失效账号
            if (invalidAccounts && invalidAccounts.length > 0) {
                for (let account of invalidAccounts) {
                    // 格式：{ userId: qq, uid: uid }
                    let key = `${account.userId}:${account.uid}`;
                    invalidSet.add(key);
                }
            }
            
            for (let dataUid of stoken) {
                for (let uuId in dataUid) {
                    if (uuId[0] * 1 > 5) {
                        continue;
                    }
                    let data = dataUid[uuId];
                    let qq = data.userId;
                    
                    // 检查是否为失效账号
                    let key = `${qq}:${uuId}`;
                    if (invalidSet.has(key)) {
                        continue; // 跳过失效账号
                    }
                    
                    // 使用Map去重，同一个QQ可能有多个UID
                    if (!userMap.has(qq)) {
                        userMap.set(qq, []);
                    }
                    userMap.get(qq).push(uuId);
                }
            }
            
            // 转换为列表格式
            for (let [qq, uids] of userMap) {
                userList.push({
                    qq: qq,
                    uids: uids
                });
            }
            
            if (userList.length === 0) {
                return '当前没有绑定米游币签到的用户';
            }
            
            // 按QQ号排序
            userList.sort((a, b) => a.qq - b.qq);
            
            // 计算总账号数（包括多个UID的情况）
            let totalAccounts = 0;
            for (let user of userList) {
                totalAccounts += user.uids.length;
            }
            
            // 构建合并转发消息数组
            let msgArray = [];
            
            // 第一段：统计信息
            let invalidCount = invalidAccounts ? invalidAccounts.length : 0;
            if (invalidCount > 0) {
                msgArray.push([
                    `【米游币签到用户列表】\n`,
                    `总用户数：${userList.length}（未标记失效）\n`,
                    `总账号数：${totalAccounts}（未标记失效）\n`,
                    `已标记失效账号：${invalidCount}个（不在此列表中）\n`,
                    `\n以下为用户列表：`
                ]);
            } else {
                msgArray.push([
                    `【米游币签到用户列表】\n`,
                    `总用户数：${userList.length}\n`,
                    `总账号数：${totalAccounts}\n`,
                    `\n以下为用户列表：`
                ]);
            }
            
            // 将用户列表分成多个消息块，每20个用户一个消息块
            const usersPerBlock = 20;
            for (let i = 0; i < userList.length; i += usersPerBlock) {
                let blockUsers = userList.slice(i, i + usersPerBlock);
                let blockMsg = [];
                
                for (let user of blockUsers) {
                    if (user.uids.length === 1) {
                        blockMsg.push(`QQ: ${user.qq} (UID: ${user.uids[0]})\n`);
                    } else {
                        blockMsg.push(`QQ: ${user.qq} (${user.uids.length}个UID: ${user.uids.join('、')})\n`);
                    }
                }
                
                msgArray.push(blockMsg);
            }
            
            // 如果有用户有多个UID，添加详情段
            let multiUidUsers = userList.filter(u => u.uids.length > 1);
            if (multiUidUsers.length > 0) {
                msgArray.push([
                    `\n【多UID用户详情】\n`,
                    `共有${multiUidUsers.length}个用户绑定了多个UID：\n`
                ]);
                
                // 多UID用户详情也分成多个块
                for (let i = 0; i < multiUidUsers.length; i += 10) {
                    let blockUsers = multiUidUsers.slice(i, i + 10);
                    let detailMsg = [];
                    for (let user of blockUsers) {
                        detailMsg.push(`QQ: ${user.qq}: ${user.uids.join('、')}\n`);
                    }
                    msgArray.push(detailMsg);
                }
            }
            
            return msgArray;
        } catch (error) {
            Bot.logger.error(`获取米游币签到列表失败: ${error}`);
            return `获取列表失败: ${error.message}`;
        }
    }

    // 获取米社签到用户列表（返回合并转发消息数组）
    async getMysSignList() {
        try {
            let userIdList = {};
            let dir = './data/MysCookie/'
            
            if (isV3) {
                if (!fs.existsSync(dir)) {
                    try {
                        let NoteUser = (await import(`file://${_path}/plugins/genshin/model/mys/NoteUser.js`)).default
                        await NoteUser.forEach(async (user) => {
                            await user.eachMysUser(async (mys) => {
                                let { qq } = user
                                let { ck, ltuid, device_id } = mys 
                                if (Object.keys(userIdList).includes(qq+'')) {
                                    let seed_id = lodash.sample('abcdefghijklmnopqrstuvwxyz', 4).replace(/,/g, '')
                                    userIdList[qq + seed_id] = {
                                        qq, ck, device_id,
                                        ltuid,
                                    }
                                } else {
                                    userIdList[qq] = {
                                        qq, ck, device_id,
                                        ltuid,
                                    }   
                                }
                            })
                        })
                    } catch (error) {
                        Bot.logger.error(`从NoteUser获取用户列表失败: ${error}`);
                    }
                } else {
                    userIdList = (await gsCfg.getBingAllCk()).ckQQ
                }
            } else {
                // 非V3版本，尝试从全局变量获取
                if (typeof NoteCookie !== 'undefined') {
                    userIdList = NoteCookie;
                } else if (typeof BotConfig !== 'undefined' && BotConfig.dailyNote) {
                    // 尝试从BotConfig获取
                    userIdList = BotConfig.dailyNote;
                }
            }
            
            // 获取失效账号列表
            let invalidAccounts = await this.getInvalidAccounts('mys');
            let invalidSet = new Set(); // 用于快速查找失效账号
            if (invalidAccounts && invalidAccounts.length > 0) {
                for (let account of invalidAccounts) {
                    // 格式：{ userId: qq }
                    invalidSet.add(String(account.userId));
                }
            }
            
            // 去重并排除失效账号
            let userMap = new Map(); // 用于去重，key为QQ号
            let userIdkeys = Object.keys(userIdList || {});
            
            for (let key of userIdkeys) {
                let user_id = key.replace(/\s+(?:n$)?/gi, '');
                let userData = userIdList[key];
                
                // 检查是否为失效账号
                if (invalidSet.has(user_id)) {
                    continue; // 跳过失效账号
                }
                
                // 去重：同一个QQ只保留一个（保留第一个）
                if (!userMap.has(user_id)) {
                    userMap.set(user_id, {
                        qq: user_id,
                        ltuid: userData?.ltuid || '',
                        key: key // 保留原始key用于获取数据
                    });
                }
            }
            
            // 转换为排序后的列表
            let sortedUsers = Array.from(userMap.values());
            sortedUsers.sort((a, b) => a.qq - b.qq);
            
            if (sortedUsers.length === 0) {
                return '当前没有绑定米社签到的用户';
            }
            
            // 构建合并转发消息数组
            let msgArray = [];
            
            // 第一段：统计信息
            msgArray.push([
                `【米社签到用户列表】\n`,
                `总用户数：${sortedUsers.length}\n`,
                `\n以下为用户列表：`
            ]);
            
            // 将用户列表分成多个消息块，每20个用户一个消息块
            const usersPerBlock = 20;
            for (let i = 0; i < sortedUsers.length; i += usersPerBlock) {
                let blockUsers = sortedUsers.slice(i, i + usersPerBlock);
                let blockMsg = [];
                
                for (let user of blockUsers) {
                    if (user.ltuid) {
                        blockMsg.push(`QQ: ${user.qq} (通行证: ${user.ltuid})\n`);
                    } else {
                        blockMsg.push(`QQ: ${user.qq}\n`);
                    }
                }
                
                msgArray.push(blockMsg);
            }
            
            return msgArray;
        } catch (error) {
            Bot.logger.error(`获取米社签到列表失败: ${error}`);
            return `获取列表失败: ${error.message}`;
        }
    }

    // 获取所有签到列表（合并转发，标记账号单独发送）
    async getAllSignList() {
        try {
            let msgArray = [];
            
            // 获取米游币签到列表
            let bbsList = await this.getBbsSignList();
            if (typeof bbsList === 'string') {
                msgArray.push([`【米游币签到列表】\n${bbsList}`]);
            } else {
                msgArray.push([`【米游币签到列表】`]);
                msgArray.push(...bbsList);
            }
            
            // 获取米社签到列表
            let mysList = await this.getMysSignList();
            if (typeof mysList === 'string') {
                msgArray.push([`【米社签到列表】\n${mysList}`]);
            } else {
                msgArray.push([`【米社签到列表】`]);
                msgArray.push(...mysList);
            }
            
            // 获取标记账号列表（单独发送）
            let invalidBbs = await this.getInvalidAccounts('bbs');
            let invalidMys = await this.getInvalidAccounts('mys');
            
            if (invalidBbs.length > 0 || invalidMys.length > 0) {
                let invalidMsg = [`【已标记失效账号列表】\n`];
                
                if (invalidBbs.length > 0) {
                    invalidMsg.push(`\n【米游币签到】失效账号：${invalidBbs.length}个\n`);
                    for (let account of invalidBbs) {
                        if (account.uid) {
                            invalidMsg.push(`QQ ${account.userId} (UID: ${account.uid})\n`);
                        } else {
                            invalidMsg.push(`QQ ${account.userId}\n`);
                        }
                    }
                }
                
                if (invalidMys.length > 0) {
                    invalidMsg.push(`\n【米社签到】失效账号：${invalidMys.length}个\n`);
                    for (let account of invalidMys) {
                        invalidMsg.push(`QQ ${account.userId}\n`);
                    }
                }
                
                invalidMsg.push(`\n提示：这些账号将在下次签到时重试，如果仍然失败，请发送【#确认删除失效账号】来删除`);
                msgArray.push(invalidMsg);
            }
            
            return msgArray;
        } catch (error) {
            Bot.logger.error(`获取所有签到列表失败: ${error}`);
            return `获取列表失败: ${error.message}`;
        }
    }
}
