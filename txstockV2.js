/*
腾讯自选股V2

更新了一下脚本，精简了需要的CK，多账户用换行(\n)或者@或者#隔开，尽量用换行隔开因为我没测试其他
一天跑两次就够了，10点到13点之间运行一次猜涨跌做任务，16点半之后运行一次领猜涨跌奖励
提现设置：默认提现5元，需要改的话自己设置TxStockCash变量，0代表不提现，1代表提现1元，5代表提现5元
新手任务设置：默认不做新手任务，需要做的话设置TxStockNewbie为1
分享任务设置：默认会做互助任务，需要多账号，黑号也能完成分享任务。不想做的话设置TxStockHelp为0
可以设置某些号只助力别的号不做任务(没资格的小号可以助力大号)，在对应的ck后面加&task=0
没有捉到微信CK的也可以跑脚本，删掉wzq_qlskey和wzq_qluin就行，会尝试用APP的CK去完成微信任务，出现做任务失败是正常现象

青龙捉包，需要捉APP和公众号里面的小程序
1. 打开APP，捉wzq.tenpay.com包，把url里的openid和fskey用&连起来填到TxStockCookie
2. 公众号 腾讯自选股微信版->右下角好福利->福利中心，捉wzq.tenpay.com包，把Cookie里的wzq_qlskey和wzq_qluin用&连起来填到TxStockCookie
格式如下：
export TxStockCookie='openid=xx&fskey=yy&wzq_qlskey=zz&wzq_qluin=aa'

V2P，圈X重写：
打开APP和小程序自动获取
小程序入口：公众号 腾讯自选股微信版->右下角好福利->福利中心
[task_local]
#腾讯自选股
35 11,16 * * * https://raw.githubusercontent.com/leafTheFish/DeathNote/main//txstockV2.js, tag=腾讯自选股, enabled=true
[rewrite_local]
https://wzq.tenpay.com/cgi-bin/.*user.*.fcgi url script-request-header https://raw.githubusercontent.com/leafTheFish/DeathNote/main//txstockV2.js
[MITM]
hostname = wzq.tenpay.com
*/
const $ = new Env('腾讯自选股V2');
const jsname = '腾讯自选股V2'

const notifyFlag = 1; //0为关闭通知，1为打开通知,默认为1
let notifyStr = ''

let envSplitor = ['\n','@','#']
let httpResult //global buffer

let helpFlag = ($.isNode() ? (process.env.TxStockHelp) : ($.getval('TxStockHelp'))) || 1; //0为不做分享助力任务，1为多用户互相分享助力
let newbieFlag = ($.isNode() ? (process.env.TxStockNewbie) : ($.getval('TxStockNewbie'))) || 0; //0为不做新手任务，1为自动做新手任务
let userCookie = ($.isNode() ? process.env.TxStockCookie : $.getdata('TxStockCookie')) || '';
let userList = []

let userIdx = 0
let userCount = 0

let TASK_WAITTIME = 100
let BULL_WAITTIME = 5000

let test_taskList = []
let todayDate = formatDateTime();
let SCI_code = '000001' //上证指数
let marketCode = {'sz':0, 'sh':1, 'hk':2, }
let signType = {task:'home', sign:'signdone', award:'award'}

let taskList = {
    app: {
        daily: [1105, 1101, 1111, 1113],
        newbie: [1023, 1033],
        dailyShare: ["news_share", "task_50_1101", "task_51_1101", "task_50_1111", "task_51_1111", "task_51_1113", "task_72_1113", "task_74_1113", "task_75_1113", "task_76_1113"],
        newbieShare: [],
    },
    wx: {
        daily: [1100, 1110, 1112],
        newbie: [1032],
        dailyShare: ["task_50_1100", "task_51_1100", "task_50_1110", "task_51_1110", "task_66_1110", "task_51_1112", "task_75_1112"],
        newbieShare: ["task_50_1032", "task_51_1032", "task_50_1033", "task_51_1033"],
    },
}

let bullTaskArray = { 
    "rock_bullish":{"taskName":"戳牛任务", "action":"rock_bullish", "actid":1105}, 
    "open_box":{"taskName":"开宝箱", "action":"open_box", "actid":1105}, 
    "open_blindbox":{"taskName":"开盲盒", "action":"open_blindbox", "actid":1105}, 
    "query_blindbox":{"taskName":"查询皮肤数量", "action":"query_blindbox", "actid":1105},
    "sell_skin":{"taskName":"卖皮肤", "action":"sell_skin", "actid":1105},
    "feed":{"taskName":"喂长牛", "action":"feed", "actid":1105},
}

///////////////////////////////////////////////////////////////////
class UserInfo {
    constructor(str) {
        this.index = ++userIdx
        this.name = this.index
        this.canRun = true
        this.hasWxCookie = true
        this.valid = false
        this.coin = -1
        this.shareCodes = {task:{}, newbie:{}, bull:{}, guess:{}}
        this.bullStatusFlag = false
        
        let info = str2json(str)
        this.openid = info['openid'] || ''
        this.fskey = info['fskey'] || ''
        this.wzq_qlskey = info['wzq_qlskey'] || ''
        this.wzq_qluin = info['wzq_qluin'] || ''
        this.task = info['task'] || 1
        this.cookie = `wzq_qlskey=${this.wzq_qlskey}; wzq_qluin=${this.wzq_qluin}; zxg_openid=${this.openid};`
        
        let checkParam = ['openid','fskey','wzq_qlskey','wzq_qluin']
        let missEnv = []
        for(let param of checkParam) {
            if(!this[param]) missEnv.push(param);
        }
        if(missEnv.length > 0) {
            let missStr = missEnv.join(', ')
            let notiStr = `账号[${this.index}]缺少参数：${missStr}`
            if(missStr.indexOf('openid') > -1 || missStr.indexOf('fskey') > -1 ) {
                notiStr += '，无法运行脚本'
                this.canRun = false
            } else if(missStr.indexOf('wzq_qlskey') > -1 || missStr.indexOf('wzq_qluin') > -1) {
                notiStr += '，尝试用APP的CK去完成微信任务和助力，可能出现失败情况'
                this.hasWxCookie = false
            }
            console.log(notiStr)
        }
    }
    
    async getUserName() {
        try {
            let url = `https://proxy.finance.qq.com/group/newstockgroup/RssService/getSightByUser2?g_openid=${this.openid}&openid=${this.openid}&fskey=${this.fskey}`
            let body = `g_openid=${this.openid}&search_openid=${this.openid}`
            let urlObject = populateUrlObject(url,this.cookie,body)
            await httpRequest('post',urlObject)
            let result = httpResult;
            if(!result) return
            //console.log(result)
            if(result.code==0) {
                thi
