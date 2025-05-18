const audioPlayer = document.getElementById("audioPlayer");
const subtitlesContainer = document.getElementById("subtitles");
const startInput = document.getElementById("startTime");
const endInput = document.getElementById("endTime");
const tooltip = document.getElementById("tooltip");
const playAllBtn = document.getElementById("playAll");
const pauseBtn = document.getElementById("pause");
const playRangeBtn = document.getElementById("playRange");
const baseSwaraSelector = document.getElementById("baseSwaraSelector");

let mediaRecorder;
let recordedChunks = [];
let duration = 0;
let recordingStartTime = 0;
let recordingTimerInterval;

const startRecordingBtn = document.getElementById("startRecording");
const stopRecordingBtn = document.getElementById("stopRecording");
const recordingIndicator = document.getElementById("recordingIndicator");
const recordingLengthDisplay = document.getElementById("recordingLength");
const downloadCSVBtn = document.getElementById('downloadCSV');
const loadAudioButton = document.getElementById("loadAudio");
const loadAudioFileElement = document.getElementById("loadAudioFile");
const loadSubtitlesButton = document.getElementById("loadSubtitles");
const loadSubtitleFileElement = document.getElementById("loadSubtitleFile");

let subtitleFileContent = null;
let subtitleNotes = [];
let subtitles = [];
let subtitleDivs = [];
let highlightedIndex = -1;
const subtitleHeight = 25;
let activeIndex = 0;

console.log('script.js loaded');

const baseSwaraNames = ["Sa", "Ri(1)", "Ri(2)", "Ga(1)", "Ga(2)", "Ma(1)", "Ma(2)", "Pa", "Da(1)", "Da(2)", "Ni(1)", "Ni(2)"];
let fullSwaraList = [];

for (let octave = 1; octave <= 6; octave++) {
    baseSwaraNames.forEach(note => {
        fullSwaraList.push(`${note}${octave}`);
    });
}

/**
 * Gets the offset for swara mapping based on the selected base swara.
 * @returns {number} The offset value.
 */
function getSwaraOffset() {
    const base = baseSwaraSelector.value;
    const offsetRef = {
        "Sa1": 0,
        "Ri1": 1,
        "Ri2": 2,
        "Ga1": 3,
        "Ga2": 4,
        "Ma1": 5,
        "Ma2": 6,
        "Pa": 7,
        "Da1": 8,
        "Da2": 9,
        "Ni1": 10,
        "Ni2": 11
    };
    return offsetRef[base] || 0;
}

/**
 * Offsets a given swara name based on the current base swara selection.
 * @param {string} originalSwara - The original swara name.
 * @returns {string} The offset swara name, or the original if no offset is needed.
 */
function offsetSwara(originalSwara) {
    if (originalSwara === "Rest") return originalSwara;
    const index = fullSwaraList.indexOf(originalSwara);
    if (index === -1) return originalSwara;
    const offset = getSwaraOffset();
    const newIndex = (index + offset) % fullSwaraList.length;
    return fullSwaraList[newIndex];
}

/**
 * Sets a cookie with a given name and value, expiring in 10 minutes.
 * @param {string} name - The name of the cookie.
 * @param {string} value - The value of the cookie.
 */
function setCookie(name, value) {
    const date = new Date();
    date.setTime(date.getTime() + (10 * 60 * 1000));
    const expires = "; expires=" + date.toUTCString();
    document.cookie = name + "=" + (value || "") + expires + "; path=/;";
    console.log(`[COOKIE] Set cookie ${name} = ${value}`);
}

/**
 * Gets the value of a cookie with a given name.
 * @param {string} name - The name of the cookie.
 * @returns {string | null} The value of the cookie, or null if not found.
 */
function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) {
            const value = c.substring(nameEQ.length, c.length);
            console.log(`[COOKIE] Get cookie ${name} = ${value}`);
            return value;
        }
    }
    return null;
}

// Event listener for the base swara selector to update displayed subtitles.
baseSwaraSelector.addEventListener("change", function () {
    console.log("baseSwaraSelector changed!");
    renderSubtitles();
    const offset = getSwaraOffset();
    console.log("Offset:", offset);
    console.log("Original Notes:", subtitleNotes);
    const offsettedNotes = subtitleNotes.map(note => {
        const offsettedNote = offsetSwara(note);
        console.log(`Original Note: ${note}, Offsetted Note: ${offsettedNote}`);
        return offsettedNote;
    });
    console.log("Offsetted Notes:", offsettedNotes);

});

// Event listener for the download CSV button.
if (!downloadCSVBtn) {
    console.error('downloadCSV button not found in DOM');
} else {
    console.log('downloadCSV button found, attaching event listener');

    downloadCSVBtn.addEventListener('click', () => {
        console.log('downloadCSV clicked');
        const audioUid = getCookie('audioUid');
        if (!audioUid) {
            alert('No audio has been processed yet. Please upload and record audio first.');
            return;
        }

        // Use the dynamically fetched Ngrok URL here:
        getNgrokUrl().then(ngrokUrl => {
            const downloadCsvEndpoint = `${ngrokUrl}/download_csv/${audioUid}`;
            console.log(`[DOWNLOAD CSV] Fetching from: ${downloadCsvEndpoint}`);
            window.location.href = downloadCsvEndpoint;
        }).catch(error => {
            console.error("Failed to fetch Ngrok URL:", error);
            alert("Failed to download CSV.  Please check your network connection and Ngrok status.");
        });
    });
}

// Event listener for the "Load Audio" button.
loadAudioButton.addEventListener("click", () => {
        loadAudioFileElement.click();
});

// Event listener for the audio file input.
loadAudioFileElement.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const audioURL = URL.createObjectURL(file);
        audioPlayer.src = audioURL;
        audioPlayer.load();

        audioPlayer.oncanplaythrough = () => {
                duration = audioPlayer.duration;
                recordingLengthDisplay.textContent = `Recording Length: ${duration.toFixed(2)} seconds`;
        };
});

// Event listener for the "Load Subtitles" button.
loadSubtitlesButton.addEventListener("click", () => {
        loadSubtitleFileElement.click();
});

/**
 * Parses the CSV subtitle data into an array of subtitle objects.
 * @param {string} csvText - The CSV text to parse.
 * @returns {Array<{time: number, end: number, text: string}>}
 */
function parseCSVSubtitles(csvText) {
        const lines = csvText.trim().split('\n');
        const subtitles = [];
        const headers = lines[0].split(',').map(h => h.trim());

        if (headers.length < 3 || headers[0] !== 'start' || headers[1] !== 'end' || headers[2] !== 'note') {
                throw new Error('Invalid CSV format. Expected headers: start, end, note');
        }

        for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',').map(v => v.trim());
                if (values.length === 3) {
                        const start = parseFloat(values[0]);
                        const end = parseFloat(values[1]);
                        const text = values[2];
                        if (!isNaN(start) && !isNaN(end)) {
                                subtitles.push({ time: start, end: end, text: text });
                        } else {
                                console.warn(`Skipping invalid subtitle entry at line ${i + 1}: ${lines[i]}`);
                        }
                } else {
                        console.warn(`Skipping invalid subtitle entry at line ${i + 1}: ${lines[i]}`);
                }
        }
        return subtitles;
}

// Event listener for the subtitle file input.
loadSubtitleFileElement.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
                const text = await file.text();
                subtitleFileContent = text;
                console.log("Subtitle file content:", text);
                const parsedSubtitles = parseCSVSubtitles(text);
                subtitles = parsedSubtitles;
                subtitleNotes = parsedSubtitles.map(sub => sub.text);
                renderSubtitles();
                updateHighlight(0);
                baseSwaraSelector.value = "Sa";
        } catch (error) {
                console.error("Error loading or parsing subtitle file:", error);
                alert("Error loading subtitle file.  Please ensure it is a valid CSV file.");
        }
});

// Event listener for the "Start Recording" button.
startRecordingBtn.onclick = async () => {
        try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                recordedChunks = [];

                mediaRecorder.ondataavailable = (e) => {
                        if (e.data.size > 0) recordedChunks.push(e.data);
                };

                mediaRecorder.onstop = async () => {
                        const blob = new Blob(recordedChunks, { type: "audio/webm" });
                        const file = new File([blob], "recorded_audio.webm", { type: "audio/webm" });

                        clearInterval(recordingTimerInterval);
                        const recordedDuration = (Date.now() - recordingStartTime) / 1000;
                        duration = recordedDuration;
                        recordingLengthDisplay.textContent = `Recording Length: ${recordedDuration.toFixed(2)} seconds`;
                        recordingIndicator.classList.add("hidden");

                        const formData = new FormData();
                        formData.append("audio", file);
                        const audioUid = crypto.randomUUID();
                        formData.append("audio_uid", audioUid);

                        audioPlayer.dataset.audioUid = audioUid;
                        setCookie('audioUid', audioUid);
                        audioPlayer.src = URL.createObjectURL(file);
                        audioPlayer.load();

                        try {
                                // Fetch Ngrok URL from GitHub
                                const ngrokUrl = await getNgrokUrl();
                                const response = await fetch(`${ngrokUrl}/upload`, {
                                        method: "POST",
                                        body: formData,
                                });

                                if (!response.ok) {
                                        throw new Error(`HTTP error! status: ${response.status}`);
                                }
                                const data = await response.json();
                                alert(data.message);
                                triggerDownload(audioUid);

                        } catch (err) {
                                alert("Upload failed: " + err.message);
                                console.error(err);
                        }

                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'recording.webm';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        URL.revokeObjectURL(blob);
                };

                mediaRecorder.start();
                startRecordingBtn.textContent = "Recording...";
                startRecordingBtn.disabled = true;
                stopRecordingBtn.disabled = false;

                recordingStartTime = Date.now();
                recordingTimerInterval = setInterval(() => {
                        const elapsedTime = (Date.now() - recordingStartTime) / 1000;
                        recordingLengthDisplay.textContent = `Recording Length: ${elapsedTime.toFixed(2)} seconds`;
                }, 100);

                recordingIndicator.classList.remove("hidden");
        } catch (err) {
                alert("Recording failed. Check microphone permissions.");
                console.error("Error starting recording:", err);
        }
};

// Event listener for the "Stop Recording" button.
stopRecordingBtn.onclick = () => {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
                mediaRecorder.stop();
                startRecordingBtn.textContent = "Start Recording";
                startRecordingBtn.disabled = false;
                stopRecordingBtn.disabled = true;
        }
};

/**
 * Renders the subtitles into the subtitles container.
 */
function renderSubtitles() {
        subtitlesContainer.innerHTML = '';
        subtitleDivs = [];
        subtitles.forEach((sub, i) => {
                const div = document.createElement("div");
                const displaySwara = offsetSwara(sub.text);
                div.textContent = displaySwara;
                div.className = "subtitle-line";
                div.dataset.index = i;
                div.dataset.originalText = sub.text;
                div.dataset.startTime = sub.time;
                div.dataset.endTime = sub.end;
                subtitleDivs.push(div);
                subtitlesContainer.appendChild(div);
                div.addEventListener("mouseenter", () => {
                        tooltip.textContent = `Start: ${sub.time.toFixed(2)}s, End: ${sub.end.toFixed(2)}s`;
                        tooltip.style.display = 'block';
                });
                div.addEventListener("mousemove", e => {
                        tooltip.style.left = `${e.pageX + 10}px`;
                        tooltip.style.top = `${e.pageY + 10}px`;
                });
                div.addEventListener("mouseleave", () => {
                        tooltip.style.display = 'none';
                });
        });
        subtitlesContainer.style.height = '100px';
        subtitlesContainer.style.overflow = 'hidden';
        subtitlesContainer.style.position = 'relative';
}

/**
 * Updates the highlighted subtitle based on the current audio playback time.
 * @param {number} currentTime - The current audio playback time.
 */
function updateHighlight(currentTime) {
        let newIndex = -1;

        for (let i = 0; i < subtitles.length; i++) {
                if (currentTime >= subtitles[i].time && currentTime < subtitles[i].end) {
                        newIndex = i;
                        break;
                }
        }

        if (newIndex !== -1 && newIndex !== activeIndex) {
                activeIndex = newIndex;
                const allLines = subtitlesContainer.querySelectorAll(".subtitle-line");
                allLines.forEach((line, i) => {
                        line.classList.toggle("highlight", i === newIndex);
                });
                const containerHeight = subtitlesContainer.clientHeight;
                const highlightedElement = allLines[newIndex];
                const elementTop = highlightedElement.offsetTop;
                const elementHeight = highlightedElement.offsetHeight;

                const scrollOffset = elementTop - (containerHeight / 2) + (elementHeight / 2);
                subtitlesContainer.scrollTo({
                        top: scrollOffset,
                        behavior: 'smooth'
                });
        }
}

// Event listener for the audio player's timeupdate event.
audioPlayer.ontimeupdate = () => {
        const currentTime = audioPlayer.currentTime;
        const endTime = Math.min(parseFloat(endInput.value), duration);

        if (currentTime >= endTime) {
                audioPlayer.pause();
                return;
        }

        updateHighlight(currentTime);
};

/**
 * Fetches the Ngrok URL from GitHub.
 * @returns {Promise<string>} The Ngrok URL.
 */
async function getNgrokUrl() {
    const githubUrl = "https://raw.githubusercontent.com/your-username/your-repo/main/ngrok_url.txt"; // Replace with your GitHub URL
    try {
        const response = await fetch(githubUrl, {
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch Ngrok URL from GitHub: ${response.status}`);
        }
        const text = await response.text();
        const fetchedNgrokUrl = text.trim();
        console.log(`[FETCHED NGROK URL] ${fetchedNgrokUrl} (via GitHub)`);
        return fetchedNgrokUrl;
    } catch (error) {
        console.error("Error fetching Ngrok URL:", error);
        alert("Error: Could not retrieve the Ngrok URL.  Please check your network connection and the GitHub URL. Make sure the file exists and is accessible.");
        throw error;
    }
}

// Event listener for file input change
document.getElementById("audioFile").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (file) {
                const formData = new FormData();
                formData.append("audio", file);
                const audioUid = crypto.randomUUID();
                formData.append("audio_uid", audioUid);
                audioPlayer.dataset.audioUid = audioUid;
                setCookie('audioUid', audioUid);
                audioPlayer.src = URL.createObjectURL(file);
                audioPlayer.load();

                try {
                        //  Fetch the Ngrok URL here.
                        const ngrokUrl = await getNgrokUrl();
                        const response = await fetch(`${ngrokUrl}/upload`, {
                                method: "POST",
                                body: formData,
                        });
                        if (!response.ok) {
                                throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        const data = await response.json();
                        alert(data.message);
                        triggerDownload(audioUid);

                } catch (err) {
                        alert("File upload failed: " + err.message);
                        console.error(err);
                }
        }
});

/**
 * Triggers the download of the CSV file using the audioUid.
 */
function triggerDownload(audioUid) {
        getNgrokUrl().then(ngrokUrl => {
                const downloadCsvEndpoint = `${ngrokUrl}/download_csv/${audioUid}`;
                console.log(`[TRIGGER DOWNLOAD] Fetching from: ${downloadCsvEndpoint}`);
                window.location.href = downloadCsvEndpoint;
        }).catch(error => {
                console.error("Failed to get Ngrok URL for download:", error);
                alert("Download failed. Please check your network connection and Ngrok status.");
        });
}


// Event listener for the "Play All" button.
playAllBtn.addEventListener('click', () => {
        audioPlayer.currentTime = 0;
        audioPlayer.play();
});

// Event listener for the "Pause" button.
pauseBtn.addEventListener('click', () => {
        audioPlayer.pause();
});

// Event listener for the "Play Range" button.
playRangeBtn.addEventListener('click', () => {
        let start = parseFloat(startInput.value);
        let end = parseFloat(endInput.value);

        if (isNaN(start) || start < 0) start = 0;
        if (isNaN(end) || end > duration) end = duration;

        startInput.value = start.toFixed(2);
        endInput.value = end.toFixed(2);

        audioPlayer.currentTime = start;
        audioPlayer.play();
});
