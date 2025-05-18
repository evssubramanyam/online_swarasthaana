const audioPlayer = document.getElementById("audioPlayer");
const subtitlesContainer = document.getElementById("subtitles");
const startInput = document.getElementById("startTime");
const endInput = document.getElementById("endTime");
const tooltip = document.getElementById("tooltip");
const playAllBtn = document.getElementById("playAll");
const pauseBtn = document.getElementById("pause");
const playRangeBtn = document.getElementById("playRange");
const baseSwaraSelector = document.getElementById("baseSwaraSelector"); // Get the selector

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

let subtitleFileContent = null; // Store the content of the subtitle file
let subtitleNotes = []; // Store the notes from the subtitle file.
let subtitles = []; // Array to store subtitle objects with time information
let subtitleDivs = []; // Array to store the subtitle div elements
let highlightedIndex = -1; // Keep track of the currently highlighted subtitle
const subtitleHeight = 25; // Approximate height of each subtitle line.  Make this configurable if needed.
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
    return offsetRef[base] || 0; // Return 0 if base is not found (e.g., "Rest")
}

/**
 * Offsets a given swara name based on the current base swara selection.
 * @param {string} originalSwara - The original swara name.
 * @returns {string} The offset swara name, or the original if no offset is needed.
 */
function offsetSwara(originalSwara) {
    if (originalSwara === "Rest") return originalSwara; // Handle "Rest" case
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
    date.setTime(date.getTime() + (10 * 60 * 1000)); // 10 minutes
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
    // Log the offset and the array
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

// Event listener for the download CSV button to initiate the download process.
if (!downloadCSVBtn) {
    console.error('downloadCSV button not found in DOM');
} else {
    console.log('downloadCSV button found, attaching event listener');

    downloadCSVBtn.addEventListener('click', () => {
        console.log('downloadCSV clicked');
        // Use cookie instead of dataset
        const audioUid = getCookie('audioUid');
        if (!audioUid) {
            alert('No audio has been processed yet. Please upload and record audio first.');
            return;
        }

        // Construct the URL for the download CSV endpoint.
        const downloadCsvEndpoint = `https://afa0-2406-b400-b4-b9eb-9d98-fe4-e796-43ca.ngrok-free.app/download_csv/${audioUid}`;  // Replace with your Ngrok URL
        console.log(`[DOWNLOAD CSV] Fetching from: ${downloadCsvEndpoint}`);

        // Use window.location.href for direct download
        window.location.href = downloadCsvEndpoint;

        // No need for the rest of the fetch code, the browser will handle the download

    });
}

// Event listener for the "Load Audio" button to trigger file selection.
loadAudioButton.addEventListener("click", () => {
    loadAudioFileElement.click();
});

// Event listener for the audio file input to handle file selection and loading.
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

// Event listener for the "Load Subtitles" button to trigger file selection.
loadSubtitlesButton.addEventListener("click", () => {
    loadSubtitleFileElement.click();
});

/**
 * Parses the CSV subtitle data into an array of subtitle objects.
 * @param {string} csvText - The CSV text to parse.
 * @returns {Array<{time: number, end: number, text: string}>} An array of subtitle objects.
 */
function parseCSVSubtitles(csvText) {
    const lines = csvText.trim().split('\n');
    const subtitles = [];
    const headers = lines[0].split(',').map(h => h.trim()); // Get headers

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
        }
        else {
            console.warn(`Skipping invalid subtitle entry at line ${i + 1}: ${lines[i]}`);
        }
    }
    return subtitles;
}



// Event listener for the subtitle file input to handle file selection and loading.
loadSubtitleFileElement.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        subtitleFileContent = text; // Store the file content
        console.log("Subtitle file content:", text);
        const parsedSubtitles = parseCSVSubtitles(text); // Parse
        subtitles = parsedSubtitles; // Store parsed subtitles
        subtitleNotes = parsedSubtitles.map(sub => sub.text); // Extract notes
        renderSubtitles(); // Initial render
        updateHighlight(0);
        baseSwaraSelector.value = "Sa"; // Reset selector
    } catch (error) {
        console.error("Error loading or parsing subtitle file:", error);
        alert("Error loading subtitle file.  Please ensure it is a valid CSV file.");
    }
});

// Event listener for the "Start Recording" button to begin audio recording.
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
            // Generate audio_uid here
            const audioUid = crypto.randomUUID();
            formData.append("audio_uid", audioUid); // Send it with the upload

            audioPlayer.dataset.audioUid = audioUid; // Store it for later use - not needed with cookie
            setCookie('audioUid', audioUid); // Store in a cookie
            audioPlayer.src = URL.createObjectURL(file); //set src so duration can be read
            audioPlayer.load();

            try {
                //  Use your server's address here
                const response = await fetch("https://afa0-2406-b400-b4-b9eb-9d98-fe4-e796-43ca.ngrok-free.app/upload", {  // Replace with your Ngrok URL
                    method: "POST",
                    body: formData,
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                alert(data.message); // Alert message
                triggerDownload(audioUid);

            } catch (err) {
                alert("Upload failed: " + err.message);
                console.error(err);
            }

            // Prompt the user to save the audio file.
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'recording.webm'; // Suggest a filename
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
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

// Event listener for the "Stop Recording" button to stop audio recording.
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
    subtitleDivs = []; // Clear the array
    subtitles.forEach((sub, i) => { // Use the subtitles array
        const div = document.createElement("div");
        const displaySwara = offsetSwara(sub.text); // Offset based on original
        div.textContent = displaySwara;
        div.className = "subtitle-line";
        div.dataset.index = i;
        div.dataset.originalText = sub.text; // Store original text
        div.dataset.startTime = sub.time;  // Store start time
        div.dataset.endTime = sub.end;    // Store end time
        subtitleDivs.push(div); // Store the div
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
    //set the height of the subtitles container.
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

    // Find the index of the subtitle that should be highlighted
    for (let i = 0; i < subtitles.length; i++) {
        if (currentTime >= subtitles[i].time && currentTime < subtitles[i].end) {
            newIndex = i;
            break; // Exit the loop once the correct subtitle is found
        }
    }

    // If a new subtitle needs to be highlighted
    if (newIndex !== -1 && newIndex !== activeIndex) {
        activeIndex = newIndex; // Update the active index
        const allLines = subtitlesContainer.querySelectorAll(".subtitle-line");
        allLines.forEach((line, i) => {
            line.classList.toggle("highlight", i === newIndex);
        });
        // Calculate and set the scroll position to center the highlighted subtitle
        const containerHeight = subtitlesContainer.clientHeight;
        const highlightedElement = allLines[newIndex];  // Use newIndex
        const elementTop = highlightedElement.offsetTop;
        const elementHeight = highlightedElement.offsetHeight;

        const scrollOffset = elementTop - (containerHeight / 2) + (elementHeight / 2);
        subtitlesContainer.scrollTo({
            top: scrollOffset,
            behavior: 'smooth' // Add smooth scrolling if desired
        });
    }
}

// Event listener for the audio player's timeupdate event to handle subtitle highlighting.
audioPlayer.ontimeupdate = () => {
    const currentTime = audioPlayer.currentTime;
    const endTime = Math.min(parseFloat(endInput.value), duration);

    if (currentTime >= endTime) {
        audioPlayer.pause();
        return;
    }

    updateHighlight(currentTime);
};

// Event listener for file input change
document.getElementById("audioFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) {
        const formData = new FormData();
        formData.append("audio", file);
        const audioUid = crypto.randomUUID();  // Generate audio_uid here
        formData.append("audio_uid", audioUid); // Send it with the upload
        audioPlayer.dataset.audioUid = audioUid; // Store it, though not needed with cookie.
        setCookie('audioUid', audioUid); //set the cookie
        audioPlayer.src = URL.createObjectURL(file); //set src so duration can be read.
        audioPlayer.load();

        try {
            // Use your server address
            const response = await fetch("https://afa0-2406-b400-b4-b9eb-9d98-fe4-e796-43ca.ngrok-free.app/upload", {  // Replace with your Ngrok URL
                method: "POST",
                body: formData,
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            alert(data.message); // Alert message
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
    const downloadCsvEndpoint = `https://afa0-2406-b400-b4-b9eb-9d98-fe4-e796-43ca.ngrok-free.app/download_csv/${audioUid}`; //  Use your Ngrok URL
    console.log(`[TRIGGER DOWNLOAD] Fetching from: ${downloadCsvEndpoint}`);

    window.location.href = downloadCsvEndpoint; // Use href for download
}


// Event listener for the "Play All" button to start audio playback from the beginning.
playAllBtn.addEventListener('click', () => {
    audioPlayer.currentTime = 0;
    audioPlayer.play();
});

// Event listener for the "Pause" button to pause audio playback.
pauseBtn.addEventListener('click', () => {
    audioPlayer.pause();
});

// Event listener for the "Play Range" button to play audio within a specified range.
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
