import axios from 'axios';
import fs from 'fs/promises';
import readline from 'readline';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ethers } from 'ethers';
import chalk from 'chalk';
import cfonts from 'cfonts';
import ora from 'ora';

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function centerText(text, color = 'yellowBright') {
  const terminalWidth = process.stdout.columns || 80;
  const textLength = text.length;
  const padding = Math.max(0, Math.floor((terminalWidth - textLength) / 2));
  return ' '.repeat(padding) + chalk[color](text);
}

function shorten(str, frontLen = 6, backLen = 4) {
  if (!str || str.length <= frontLen + backLen) return str;
  return `${str.slice(0, frontLen)}....${str.slice(-backLen)}`;
}

async function readPrivateKeys() {
  try {
    const data = await fs.readFile('pk.txt', 'utf-8');
    return data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  } catch (error) {
    console.error(chalk.red(`Error membaca pk.txt: ${error.message}`));
    return [];
  }
}

async function readProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf-8');
    const proxies = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (proxies.length === 0) console.log(chalk.yellow('File proxy.txt kosong. Melanjutkan tanpa proxy.'));
    return proxies;
  } catch (error) {
    console.log(chalk.yellow('File proxy.txt tidak ditemukan. Melanjutkan tanpa proxy.'));
    return [];
  }
}

function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

function getHeaders(cookie = '') {
    return {
      'accept': 'application/json, text/plain, */*',
      'accept-encoding': 'gzip, deflate, br, zstd',
      'accept-language': 'en-US,en;q=0.9,id;q=0.8',
      'content-type': 'application/json',
      'origin': 'https://token.gpu.net',
      'priority': 'u=1, i',
      'referer': 'https://token.gpu.net/',
      'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      ...(cookie && { 'cookie': cookie })
    };
  }

function getProxyAgent(proxy) {
  if (!proxy) return undefined;
  if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
    return new SocksProxyAgent(proxy);
  } else {
    console.log(chalk.yellow(`Tipe proxy tidak dikenal: ${proxy}.`));
    return new HttpsProxyAgent(proxy);
  }
}

async function getPublicIP(proxy) {
    try {
      const config = proxy ? { httpsAgent: proxy.startsWith('http') ? new HttpsProxyAgent(proxy) : new SocksProxyAgent(proxy) } : {};
      const response = await axios.get('https://api.ipify.org?format=json', config);
      return response.data.ip;
    } catch (error) {
      return 'Error getting IP';
    }
  }

  
async function getNonce(proxy) {
    const spinner = ora(' Getting Nonce...').start();
    try {
      const response = await axios.get('https://quest-api.gpu.net/api/auth/eth/nonce', {
        headers: getHeaders(), 
        httpsAgent: getProxyAgent(proxy)
      });
      const nonce = response.data;
      const setCookies = response.headers['set-cookie'] || [];
      const cookie = setCookies.map(c => c.split(';')[0]).join('; ');
      spinner.succeed(chalk.greenBright(` Nonce Gotted: ${nonce}`));
      return { nonce, cookie };
    } catch (error) {
      spinner.fail(chalk.redBright(` Failed To Get Nonce: ${error.message}`));
      return null;
    }
  }

  async function signAndVerify(wallet, nonce, initialCookie, proxy) {
    const spinner = ora(' Login Procces...').start();
    try {
      const address = wallet.address;
      const message = `token.gpu.net wants you to sign in with your Ethereum account:\n${address}\n\nSign in with Ethereum to the app.\n\nURI: https://token.gpu.net\nVersion: 1\nChain ID: 4048\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
      const signature = await wallet.signMessage(message);
  
      const payload = { message, signature };
      const response = await axios.post('https://quest-api.gpu.net/api/auth/eth/verify', payload, {
        headers: getHeaders(initialCookie),
        httpsAgent: getProxyAgent(proxy)
      });
  
      const setCookies = response.headers['set-cookie'] || [];
      const updatedCookie = setCookies.map(c => c.split(';')[0]).join('; ') || initialCookie;
  
      if (response.data === 'ok') {
        spinner.succeed(chalk.greenBright(' Login Successfully'));
        return updatedCookie;
      } else {
        throw new Error(' Verification Failled');
      }
    } catch (error) {
      spinner.fail(chalk.redBright(` Login Error: ${error.message}`));
      return null;
    }
  }

  async function getUserInfo(cookie, proxy) {
    const spinner = ora(' Getting Account Info...').start();
    try {
      const response = await axios.get('https://quest-api.gpu.net/api/users/me', {
        headers: getHeaders(cookie),
        httpsAgent: getProxyAgent(proxy)
      });
      const userData = response.data;
      spinner.succeed(chalk.greenBright(' Account Info Received'));
      return userData;
    } catch (error) {
      spinner.fail(chalk.redBright(` Error Getting Account Info: ${error.message}`));
      return null;
    }
  }

async function getTasks(cookie, proxy) {
  const spinner = ora(' Getting Task List...').start();
  const taskEndpoints = [
    { category: 'Social', url: 'https://quest-api.gpu.net/api/users/social/tasks' },
    { category: 'GpuNet', url: 'https://quest-api.gpu.net/api/users/gpunet/tasks' },
  ];
  const tasks = {};

  try {
    for (const endpoint of taskEndpoints) {
      const response = await axios.get(endpoint.url, {
        headers: getHeaders(cookie),
        httpsAgent: getProxyAgent(proxy)
      });
      tasks[endpoint.category] = response.data.map(task => ({
        id: task.id,
        name: task.name,
        description: task.description,
        completed: task.completed
      }));
    }
    spinner.succeed(chalk.greenBright(' Task List Received'));
    return tasks;
  } catch (error) {
    spinner.fail(chalk.redBright(` Error Getting Task List: ${error.message}`));
    return null;
  }
}

async function completeTask(category, taskId, taskName, cookie, proxy) {
    const spinner = ora(` Compliting Task: ${taskName}...`).start();
    let verifyUrl;
    switch (category) {
      case 'Social':
        verifyUrl = `https://quest-api.gpu.net/api/users/social/tasks/${taskId}/verify`;
        break;
      case 'GpuNet':
        verifyUrl = `https://quest-api.gpu.net/api/users/gpunet/tasks/${taskId}/verify`;
        break;
      default:
        throw new Error(' Unknown Task Category');
    }
  
    try {
      let response;
      if (category === 'GpuNet') {
        response = await axios.post(verifyUrl, {}, {
          headers: getHeaders(cookie),
          httpsAgent: getProxyAgent(proxy)
        });
      } else {
        response = await axios.get(verifyUrl, {
          headers: getHeaders(cookie),
          httpsAgent: getProxyAgent(proxy)
        });
      }
  
      if (response.data.success) {
        spinner.succeed(chalk.greenBright(` Task "${taskName}" Done`));
        return true;
      } else {
        throw new Error(response.data.message);
      }
    } catch (error) {
      spinner.fail(chalk.redBright(` Failed Completing Task "${taskName}": ${error.message}`));
      return false;
    }
  }

async function dailyCheckIn(cookie, proxy) {
  const spinner = ora(' Procces Daily Check-In...').start();
  try {
    const response = await axios.get('https://quest-api.gpu.net/api/users/streak', {
      headers: getHeaders(cookie),
      httpsAgent: getProxyAgent(proxy)
    });
    const { streak, lastVisitDate } = response.data;
    const lastVisit = new Date(lastVisitDate);
    const today = new Date();
    const isToday = lastVisit.toDateString() === today.toDateString();

    if (isToday) {
      spinner.succeed(chalk.yellowBright(` Already CheckIn Today, Streak: ${streak}`));
    } else {
      spinner.succeed(chalk.greenBright(` Checkin Succesfully, Streak: ${streak}`));
    }
    return streak;
  } catch (error) {
    spinner.fail(chalk.redBright(` Checkin Failed: ${error.message}`));
    return null;
  }
}

async function getGPXPoints(cookie, proxy) {
  const spinner = ora(' Getting Point Info...').start();
  try {
    const response = await axios.get('https://quest-api.gpu.net/api/users/exp', {
      headers: getHeaders(cookie),
      httpsAgent: getProxyAgent(proxy)
    });
    const points = response.data;
    spinner.succeed(chalk.greenBright(` GPX Points : ${points}`));
    return points;
  } catch (error) {
    spinner.fail(chalk.redBright(` Failed Getting Points Info: ${error.message}`));
    return null;
  }
}

async function processAccount(privateKey, proxy) {
    try {
      const wallet = new ethers.Wallet(privateKey);
      const nonceData = await getNonce(proxy);
      if (!nonceData) return;
  
      const { nonce, cookie: initialCookie } = nonceData;
      const sessionCookie = await signAndVerify(wallet, nonce, initialCookie, proxy);
      if (!sessionCookie) return;
  
      const userInfo = await getUserInfo(sessionCookie, proxy);
      if (!userInfo) return;
  
      console.log();
      console.log(chalk.bold.whiteBright(`Wallet: ${shorten(userInfo.id)}`));
      const ip = await getPublicIP(proxy); 
      console.log(chalk.bold.whiteBright(`Using IP : ${ip}`));
      console.log(chalk.bold.cyanBright('='.repeat(80)));
      console.log();
  
      const tasks = await getTasks(sessionCookie, proxy);
      if (!tasks) return;
      console.log();
      for (const [category, taskList] of Object.entries(tasks)) {
        console.log(chalk.cyanBright(`Category: ${category}`));
        for (const task of taskList) {
          if (category === 'GpuNet' && [3, 4, 5].includes(task.id)) {
            console.log(chalk.yellowBright(` ➥ Skipping Task : ${task.description} - Need Manual Verification`));
            continue;
          }
          if (!task.completed) {
            await completeTask(category, task.id, task.description, sessionCookie, proxy);
          } else {
            console.log(chalk.bold.grey(` ➥ Task Already Done: ${task.description}`));
          }
        }
      }
  
      console.log();
      await dailyCheckIn(sessionCookie, proxy);
      console.log();
      const points = await getGPXPoints(sessionCookie, proxy);
  
      console.log(chalk.yellowBright(`\nDone Proccessed Wallet: ${shorten(wallet.address)}`));
    } catch (error) {
      console.error(chalk.red(`\nError Proccesing Wallet: ${error.message}`));
    }
  }

async function processWallets(privateKeys, proxies, useProxy) {
  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i];
    const proxy = useProxy && proxies.length > 0 ? proxies[i % proxies.length] : null;
    console.log();
    console.log(chalk.bold.cyanBright('='.repeat(80)));
    console.log(chalk.bold.whiteBright(`Accounts: ${i + 1}/${privateKeys.length}`));
    await processAccount(privateKey, proxy);
  }
  console.log();
  console.log(chalk.bold.cyanBright('='.repeat(80)));
  console.log(chalk.greenBright(' All Account Already Processed .\n'));
  console.log(chalk.yellowBright('Waiting 24 Hours Before Next Loop...'));
  setTimeout(() => processWallets(privateKeys, proxies, useProxy), 24 * 60 * 60 * 1000);
}

async function run() {
  cfonts.say('KaRPaL', {
    font: 'block',
    align: 'center',
    colors: ['cyan', 'magenta'],
    background: 'transparent',
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: '0'
  });
  console.log(centerText("=== KaRPaL ==="));
  console.log(centerText("✪ GPUNET Auto Daily Checkin & Task ✪ \n"));

  const useProxyAns = await askQuestion('Want To Use Proxy ? (y/n): ');
  const useProxy = useProxyAns.trim().toLowerCase() === 'y';
  let proxies = [];
  if (useProxy) {
    proxies = await readProxies();
    if (proxies.length === 0) {
        console.log(chalk.yellow('Proxy Not Availlable in Proxy.txt , Continue Without Proxy.'));
    }
  }

  const privateKeys = await readPrivateKeys();
  if (privateKeys.length === 0) {
    console.log(chalk.red(' No Private Key Found on pk.txt. Exit...'));
    return;
  }

  await processWallets(privateKeys, proxies, useProxy);
}

run().catch(error => console.error(chalk.red(`Error: ${error.message}`)));
