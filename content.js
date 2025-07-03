// This script is injected into the Bilibili video page to extract video data.

(function() {
  // Check if the __playinfo__ object is available on the page
  if (window.__playinfo__ && window.__playinfo__.data && window.__playinfo__.data.dash) {
    const audioStreams = window.__playinfo__.data.dash.audio;
    if (audioStreams && audioStreams.length > 0) {
      // Select the audio stream with the highest bandwidth
      const bestAudio = audioStreams.sort((a, b) => b.bandwidth - a.bandwidth)[0];
      
      // Send the audio URL back to the extension's popup script
      chrome.runtime.sendMessage({ 
        type: 'BILIBILI_AUDIO_DATA', 
        payload: {
          url: bestAudio.baseUrl,
          codecs: bestAudio.codecs
        }
      });
    } else {
      chrome.runtime.sendMessage({ type: 'BILIBILI_DATA_ERROR', payload: 'No audio streams found.' });
    }
  } else {
    chrome.runtime.sendMessage({ type: 'BILIBILI_DATA_ERROR', payload: 'Could not find Bilibili video data (__playinfo__).' });
  }
})();