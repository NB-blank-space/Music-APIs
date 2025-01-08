// 对 imgKey 和 subKey 进行字符顺序打乱编码
const mixinKeyEncTab = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5,
    49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24,
    55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63,
    57, 62, 11, 36, 20, 34, 44, 52,
];

// 获取混淆后的 key
function getMixinKey(orig) {
    return mixinKeyEncTab
        .map((n) => orig[n])
        .join("")
        .slice(0, 32);
}

/**
 * 使用代理服务器的通用请求函数：
 * - url: 目标请求URL
 * - method: 请求方法 (默认 GET)
 * - headers: 请求头对象
 * - params: URL参数 (如需添加查询字符串)
 * - body: POST/PUT 请求体
 * - 返回获取到的 body 内容 (如果是 JSON，已解析为对象)
 */
async function proxyFetch({
    url,
    method = "GET",
    headers = {},
    params = {},
    body = null,
}) {
    // 将 params 转为查询字符串
    const queryString = new URLSearchParams(params).toString();
    const finalUrl = queryString ? `${url}?${queryString}` : url;

    // 使用代理服务器 https://nbgroup.pythonanywhere.com/proxy
    const response = await fetch(
        "https://nbgroup.pythonanywhere.com/proxy",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                url: finalUrl,
                method,
                headers,
                body,
            }),
        }
    );

    const proxyResult = await response.json();
    // proxyResult.body 会包含目标请求的响应
    return proxyResult.body;
}

// 获取API所需的cookies
async function getBuvidValues() {
    try {
        // 先访问主页获取初始cookies
        const initResponse = await proxyFetch({
            url: "https://www.bilibili.com/",
            method: "GET",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
            }
        });

        // 从代理返回的headers中获取cookies
        if (initResponse.headers && initResponse.headers['set-cookie']) {
            // 提取所需的cookies
            const cookies = initResponse.headers['set-cookie'];
            const buvid3 = cookies.find(cookie => cookie.includes('buvid3='))?.split(';')[0];
            const buvid4 = cookies.find(cookie => cookie.includes('buvid4='))?.split(';')[0];

            // 返回组合后的cookies字符串
            return `${buvid3}; ${buvid4}`;
        }

        // 如果无法获取cookies，回退到原来的方案
        const data = await proxyFetch({
            url: "https://api.bilibili.com/x/frontend/finger/spi",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
                "Referer": "https://www.bilibili.com/"
            }
        });

        if (data.code === 0) {
            return data.data.b_3;
        }

        throw new Error("Failed to get buvid values");

    } catch (error) {
        console.error("Failed to get cookies:", error);
        throw error;
    }
}
// 对请求参数进行 Wbi 签名
function encWbi(params, imgKey, subKey) {
    const mixinKey = getMixinKey(imgKey + subKey);
    const currTime = Math.round(Date.now() / 1000);
    const chrFilter = /[!'()*]/g;

    // 添加 wts 字段
    params.wts = currTime;

    // 按 key 重排序并生成查询字符串
    const query = Object.keys(params)
        .sort()
        .map((key) => {
            const value = params[key].toString().replace(chrFilter, "");
            return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        })
        .join("&");

    // 计算 w_rid
    const wbiSign = md5(query + mixinKey);
    return `${query}&w_rid=${wbiSign}`;
}

/**
 * 获取最新的 Wbi Keys (img_key 和 sub_key)
 * - 需要使用代理访问 https://api.bilibili.com/x/web-interface/nav
 * - 需在 headers 中传入 SESSDATA
 */
async function getWbiKeys(sessdata = "xxxxxx") {
    const json = await proxyFetch({
        url: "https://api.bilibili.com/x/web-interface/nav",
        method: "GET",
        headers: {
            Cookie: `SESSDATA=${sessdata}`,
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
            Referer: "https://www.bilibili.com/",
        },
    });

    const {
        wbi_img: { img_url, sub_url },
    } = json.data;

    return {
        img_key: img_url.slice(
            img_url.lastIndexOf("/") + 1,
            img_url.lastIndexOf(".")
        ),
        sub_key: sub_url.slice(
            sub_url.lastIndexOf("/") + 1,
            sub_url.lastIndexOf(".")
        ),
    };
}

/**
 * B站视频搜索：
 * - keyword: 搜索关键词
 * - search_type: 搜索类型
 * - page: 页码
 * - order: 排序方式
 * - duration: 视频时长筛选
 * - tids: 视频分区筛选
 * 通过代理服务器来避免跨域。
 */
async function searchBilibiliVideo(
    keyword,
    search_type = "video",
    page = 1,
    order = "totalrank",
    duration = 0,
    tids = 0
) {
    // 获取最新的Wbi Key
    const { img_key, sub_key } = await getWbiKeys("XXXX");
    // 基本查询参数
    const params = {
        search_type: "video",
        keyword,
        order,
        duration,
        tids,
        page,
    };
    // 生成Wbi加密查询
    const query = encWbi(params, img_key, sub_key);
    // 拼接上目标API
    const finalUrl = `https://api.bilibili.com/x/web-interface/wbi/search/type?${query}`;

    // 通过proxyFetch发起请求
    const resJson = await proxyFetch({
        url: finalUrl,
        method: "GET",
        headers: {
            Cookie: `buvid3=AB5AD99B-D8A9-34C3-6C1B-CEEC5BE6FF8527361infoc; b_nut=1736155727; b_lsid=25ADD3BE_1943AF20CFE; _uuid=1AF5F127-1082B-38510-5438-EFDB1834541F29179infoc; buvid_fp=5857ee8e41c5baf5b68bc8aa557dba82; enable_web_push=DISABLE; home_feed_column=4; browser_resolution=798-927; bmg_af_switch=1; bmg_src_def_domain=i1.hdslb.com; buvid4=7548B270-839A-F85F-A0B1-9AA77C5F68A533385-025010609-0lKJqwtJRGBuwNvSg1OGSA%3D%3D; bili_ticket=eyJhbGciOiJIUzI1NiIsImtpZCI6InMwMyIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3MzY0MTQ5MzYsImlhdCI6MTczNjE1NTY3NiwicGx0IjotMX0.sL6uXhYi6JmtATuJAxPFpA6GnDgCbr0gRVk-qW9hH_k; bili_ticket_expires=1736414876`,
            Referer: "https://www.bilibili.com/",
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
        },
    });
    let data = resJson.data.result;
    return data
}

// 测试调用示例
async function main(keyword) {
    const result = await searchBilibiliVideo(keyword, 1);
    return result;
}
async function getCid(videoId, isBvid = true) {
    const proxyUrl = 'https://nbgroup.pythonanywhere.com/proxy';  // Your proxy URL
    const bilibiliApiUrl = 'https://api.bilibili.com/x/web-interface/view';
    const params = isBvid
        ? { bvid: videoId }
        : { avid: videoId };

    try {
        // 向代理服务器发送请求，代理Bilibili API请求
        const response = await axios.post(proxyUrl, {
            url: bilibiliApiUrl,
            method: 'GET',
            params: params,
            headers: {
                Referer: 'https://www.bilibili.com',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
        });

        const data = response.data.body; // 代理返回的数据
        if (data.code !== 0) {
            throw new Error(data.message || '获取视频信息失败');
        }

        const cid = data.data.cid;
        if (!cid) {
            throw new Error('未找到Cid');
        }

        return cid;
    } catch (error) {
        console.error('获取Cid时出错:', error.message);
        throw error;
    }
}

async function getAudioLink(videoId, isBvid = true) {
    const proxyUrl = 'https://nbgroup.pythonanywhere.com/proxy';  // Proxy URL
    const bilibiliApiUrl = 'https://api.bilibili.com/x/player/playurl';

    try {
        // 获取视频的Cid
        const cid = await getCid(videoId, isBvid);

        const params = isBvid
            ? { bvid: videoId, cid: cid, fnval: 16, fnver: 0, fourk: 1 }
            : { avid: videoId, cid: cid, fnval: 16, fnver: 0, fourk: 1 };

        // 向代理服务器发送请求，获取音频链接
        const response = await axios.post(proxyUrl, {
            url: bilibiliApiUrl,
            method: 'GET',
            params: params,
            headers: {
                Referer: 'https://www.bilibili.com',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
        });

        const data = response.data.body; // 代理返回的数据
        if (data.code !== 0) {
            throw new Error(data.message || '获取音频链接失败');
        }

        const audioStream = data.data.dash.audio;
        if (!audioStream || audioStream.length === 0) {
            throw new Error('未找到音频流');
        }

        const bestAudio = audioStream[0];

        return [bestAudio.baseUrl, bestAudio.backupUrl];
    } catch (error) {
        console.error('获取音频链接时出错:', error.message);
        throw error;
    }
}

async function main(bvid) {
    try {
        const audioLink = await getAudioLink(bvid, true);
        return audioLink;
    } catch (error) {
        console.error('无法获取音频链接:', error.message);
    }
}

// 搜索歌曲并获取歌词与逐字歌词的函数
async function getLyrics(songName) {
    // 代理服务器地址
    const proxyUrl = "https://api.codetabs.com/v1/proxy?quest=";
    try {
        // 1. 搜索歌曲
        const searchResponse = await axios.get(
            proxyUrl +
            encodeURIComponent(
                "https://docs-neteasecloudmusicapi.vercel.app/search?keywords=" +
                songName +
                "&limit=1"
            )
        );

        const searchResult = searchResponse.data;
        if (
            !searchResult.result ||
            !searchResult.result.songs ||
            searchResult.result.songs.length === 0
        ) {
            return "暂无歌词，尽情欣赏音乐";
        }

        const songId = searchResult.result.songs[0].id;

        const yrcResponse = await axios.get(
            proxyUrl +
            encodeURIComponent(
                `https://docs-neteasecloudmusicapi.vercel.app/lyric/new?id=${songId}`
            )
        );

        if (!yrcResponse.data) {
            return "暂无歌词，尽情欣赏音乐";
        }
        const yrcLyrics = yrcResponse.data;
        // 如果有yrcLyrics.yrc就返回yrcLyrics.yrc.lyric，否则有lrc返回lrc.lyric，否则返回暂无歌词，尽情欣赏音乐
        return yrcLyrics.yrc ? yrcLyrics.yrc.lyric : yrcLyrics.lrc ? yrcLyrics.lrc.lyric : "暂无歌词，尽情欣赏音乐";
    } catch (error) {
    }
}
