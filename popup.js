// Import necessary libraries.
// NOTE: You need to manage the ffmpeg library yourself.
// Download it from https://ffmpegwasm.netlify.app/
// and place the necessary files in your project.
import { FFmpeg } from './lib/@ffmpeg/ffmpeg/dist/esm/index.js'; // ADJUST THIS PATH
import { fetchFile } from './lib/@ffmpeg/util/dist/esm/index.js'; // ADJUST THIS PATH

// Import Transformers.js
import { pipeline, env } from './lib/transformers.min.js';

// To disable remote model downloads if you have them locally
env.allowRemoteModels = true;

const summarizeBtn = document.getElementById('summarizeBtn');
const statusDiv = document.getElementById('status');
const summaryDiv = document.getElementById('summary');
const videoUrlInput = document.getElementById('videoUrl');
const openOptionsPage = document.getElementById('openOptionsPage');

let ffmpeg;
let transcriber;

// --- Helper Functions ---

function updateStatus(message) {
  console.log(message);
  statusDiv.textContent = message;
}

function showSummary(text) {
  summaryDiv.textContent = text;
  summaryDiv.hidden = false;
}

function showError(message) {
  updateStatus(`错误: ${message}`);
  statusDiv.style.color = 'red';
}

async function loadFFmpeg() {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      console.log(message);
    });
    updateStatus('正在加载核心组件 (ffmpeg)...');
    await ffmpeg.load();
  }
  return ffmpeg;
}

async function loadTranscriber() {
    if (!transcriber) {
        updateStatus('正在加载AI模型 (Whisper)...');
        // This will download the model from Hugging Face Hub the first time.
        transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
    }
    return transcriber;
}


// --- Main Logic ---

summarizeBtn.addEventListener('click', async () => {
  const url = videoUrlInput.value;
  if (!url || !url.includes('bilibili.com')) {
    showError('请输入一个有效的Bilibili视频链接。');
    return;
  }

  // Reset UI
  statusDiv.style.color = '#333';
  summaryDiv.hidden = true;
  updateStatus('正在分析页面...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check if the URL of the active tab is the one we want to process
    if (tab.url && tab.url.startsWith(url.split('?')[0])) {
         // If it is, inject the script directly
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js'],
        });
    } else {
        // Otherwise, create a new tab, inject the script, and then close it
        updateStatus('正在新标签页中打开链接以提取数据...');
        const newTab = await chrome.tabs.create({ url: url, active: false });
        
        // Wait for the tab to load before injecting
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === newTab.id && info.status === 'complete') {
                chrome.scripting.executeScript({
                    target: { tabId: newTab.id },
                    files: ['content.js'],
                });
                // Remove listener to avoid multiple injections
                chrome.tabs.onUpdated.removeListener(listener);
            }
        });
    }
  } catch (error) {
    showError(`注入脚本失败: ${error.message}`);
  }
});


// Listen for messages from the content script
chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'BILIBILI_DATA_ERROR') {
    showError(message.payload);
    return;
  }

  if (message.type === 'BILIBILI_AUDIO_DATA') {
    // Once we have the data, we can close the temporary tab if it exists
    const tabs = await chrome.tabs.query({url: message.payload.url.split('?')[0] + "*"});
    const currentTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    for(const tab of tabs) {
        if(tab.id !== currentTab.id) {
            chrome.tabs.remove(tab.id);
        }
    }
    
    await processVideo(message.payload);
  }
});

async function processVideo({ url, codecs }) {
  try {
    // 1. Download Audio
    updateStatus('1/4 - 正在下载音频...');
    const audioBlob = await fetch(url).then(res => {
      if (!res.ok) throw new Error(`下载失败: ${res.status} ${res.statusText}`);
      return res.blob();
    });
    const audioBuffer = await audioBlob.arrayBuffer();

    // 2. Convert Audio with ffmpeg
    await loadFFmpeg();
    updateStatus('2/4 - 正在转换音频格式...');
    const inputFileName = `input.${codecs.includes('mp4a') ? 'mp4' : 'm4s'}`;
    ffmpeg.FS('writeFile', inputFileName, new Uint8Array(audioBuffer));
    
    await ffmpeg.run('-i', inputFileName, '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', 'output.wav');
    
    const wavData = ffmpeg.FS('readFile', 'output.wav');
    const wavBlob = new Blob([wavData.buffer], { type: 'audio/wav' });

    // 3. Transcribe Audio with Whisper
    await loadTranscriber();
    updateStatus('3/4 - 正在识别文本 (此过程较慢)...');
    const transcription = await transcriber(wavBlob, {
        chunk_length_s: 30,
        stride_length_s: 5
    });
    const transcribedText = transcription.text;
    updateStatus('文本识别完成！');
    showSummary(`识别出的文本:\n${transcribedText}`);

    // 4. Summarize with OpenRouter
    updateStatus('4/4 - 正在调用AI生成总结...');
    const { openRouterApiKey } = await chrome.storage.local.get('openRouterApiKey');
    if (!openRouterApiKey) {
      showError('请在设置页面配置 OpenRouter API Key！');
      return;
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": "openai/gpt-3.5-turbo", // Or any other model
        "messages": [
          { "role": "system", "content": "You are an expert assistant that summarizes video transcripts. Provide a concise summary in bullet points." },
          { "role": "user", "content": `Please summarize the following text:\n\n${transcribedText}` }
        ]
      })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenRouter API 错误: ${errorData.error.message}`);
    }

    const result = await response.json();
    const summary = result.choices[0].message.content;

    // 5. Display final summary
    updateStatus('总结完成！');
    showSummary(summary);

  } catch (error) {
    showError(error.message);
    console.error(error);
  }
}

// --- Event Listeners ---
openOptionsPage.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
