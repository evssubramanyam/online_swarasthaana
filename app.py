from flask import Flask, request, jsonify, send_file, session, url_for, make_response
import os
from werkzeug.utils import secure_filename
import subprocess
import csv
import io
import traceback
import datetime
import json
from flask_cors import CORS
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import librosa
from librosa import display as librosadisplay
from scipy.io import wavfile
from pydub import AudioSegment
import tensorflow as tf
import tensorflow_hub as hub
import music21
import statistics
import math
import tempfile
from werkzeug.wsgi import wrap_file
import requests
import threading
import time

app = Flask(__name__)
CORS(app)
app.secret_key = os.urandom(24)
UPLOAD_FOLDER = 'uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
ALLOWED_EXTENSIONS = {'wav', 'mp3', 'webm'}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

EXPECTED_SAMPLE_RATE = 16000
MAX_ABS_INT16 = 32768.0

spice_model = hub.load("C://Users//erkri//.cache//kagglehub//models//google//spice//TensorFlow1//spice//2")

A4 = 440
C0 = A4 * pow(2, -4.75)
note_names = ["Sa", "Ri(1)", "Ri(2)", "Ga(1)", "Ga(2)", "Ma(1)", "Ma(2)", "Pa", "Da(1)", "Da(2)", "Ni(1)", "Ni(2)"]

# Global dictionary to store audio_uid to file path and timestamp mapping
AUDIO_UID_TO_CSV_PATH = {}  # {audio_uid: (file_path, timestamp)}


def allowed_file(filename):
    """Checks if the file extension is allowed."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def convert_audio_for_model(user_file, output_file='converted_audio.wav'):
    """Converts the input audio file to the format required by the model.
    Args:
        user_file (str): Path to the input audio file.
        output_file (str, optional): Path to the output converted audio file.
            Defaults to 'converted_audio.wav'.
    Returns:
        str: Path to the converted audio file.
    """
    try:
        audio = AudioSegment.from_file(user_file)
        audio = audio.set_frame_rate(EXPECTED_SAMPLE_RATE).set_channels(1)
        audio.export(output_file, format='wav')
        return output_file
    except Exception as e:
        raise Exception(f"Error during audio conversion: {e}")



def plot_waveform(audio_samples, filename='waveform.png'):
    """Plots the waveform of the audio samples and saves it to a file.
    Args:
        audio_samples (np.ndarray): Array of audio samples.
        filename (str, optional): Path to save the waveform plot.
    """
    try:
        plt.figure(figsize=(12, 4))
        plt.plot(audio_samples)
        plt.title("Waveform")
        plt.savefig(filename)
        plt.close()
    except Exception as e:
        raise Exception(f"Error during waveform plotting: {e}")



def plot_stft(audio_samples, sample_rate, filename='spectrogram.png'):
    """Plots the spectrogram of the audio samples and saves it to a file.
    Args:
        audio_samples (np.ndarray): Array of audio samples.
        sample_rate (int): Sample rate of the audio.
        filename (str, optional): Path to save the spectrogram plot.
    """
    try:
        x_stft = np.abs(librosa.stft(audio_samples, n_fft=2048))
        x_stft_db = librosa.amplitude_to_db(x_stft, ref=np.max)
        plt.figure(figsize=(14, 6))
        librosadisplay.specshow(x_stft_db, y_axis='log', sr=sample_rate)
        plt.colorbar(format='%+2.0f dB')
        plt.title("Spectrogram (log scale)")
        plt.savefig(filename)
        plt.close()
    except Exception as e:
        raise Exception(f"Error during spectrogram plotting: {e}")



def plot_pitch_confidence(pitch, confidence, filename='pitch_confidence.png'):
    """Plots the pitch and confidence values and saves them to a file.
    Args:
        pitch (np.ndarray): Array of pitch values.
        confidence (np.ndarray): Array of confidence values.
    """
    try:
        plt.figure(figsize=(20, 10))
        plt.plot(pitch, label='pitch')
        plt.plot(confidence, label='confidence')
        plt.legend(loc="lower right")
        plt.title("Pitch and Confidence")
        plt.savefig(filename)
        plt.close()
    except Exception as e:
        raise Exception(f"Error during pitch and confidence plotting: {e}")



def plot_confident_pitches(pitch, confidence, filename='confident_pitch.png'):
    """Plots the confident pitch outputs.
    Args:
        pitch (np.ndarray): Array of pitch values.
        confidence (np.ndarray): Array of confidence values.
    """
    try:
        indices = range(len(pitch))
        confident_pitch_outputs = [(i, p) for i, p, c in zip(indices, pitch, confidence) if c >= 0.9]
        if not confident_pitch_outputs:
            return
        x, y = zip(*confident_pitch_outputs)
        plt.figure(figsize=(20, 10))
        plt.ylim([0, 1])
        plt.scatter(x, y, c='r')
        plt.title("Confident Pitch Outputs (confidence ≥ 0.9)")
        plt.savefig(filename)
        plt.close()
    except Exception as e:
        raise Exception(f"Error during confident pitches plotting: {e}")



def output2hz(pitch_output):
    """Converts pitch output to frequency in Hz.
    Args:
        pitch_output (float): Pitch output value.
    Returns:
        float: Frequency in Hz.
    """
    PT_OFFSET = 25.58
    PT_SLOPE = 63.07
    FMIN = 10.0
    BINS_PER_OCTAVE = 12.0
    cqt_bin = pitch_output * PT_SLOPE + PT_OFFSET
    return FMIN * 2.0 ** (cqt_bin / BINS_PER_OCTAVE)



def hz2offset(freq):
    """Converts frequency in Hz to offset.
    Args:
        freq (float): Frequency in Hz.
    Returns:
        float or None: Offset value, or None if frequency is 0.
    """
    if freq == 0:
        return None
    h = round(12 * math.log2(freq / C0))
    return 12 * math.log2(freq / C0) - h



def quantize_predictions(group, ideal_offset):
    """Quantizes pitch predictions into notes or rests.
    Args:
        group (list): List of pitch values for a time group.
        ideal_offset (float): Ideal offset value.
    Returns:
        tuple: (quantization_error, note_or_rest) where
            quantization_error (float): The error of quantization.
            note_or_rest (str): The quantized note or "Rest".
    """
    non_zero_values = [v for v in group if v != 0]
    zero_values_count = len(group) - len(non_zero_values)
    if zero_values_count > 0.8 * len(group):
        return 0.51 * len(non_zero_values), "Rest"
    else:
        h = round(
            statistics.mean([12 * math.log2(freq / C0) - ideal_offset for freq in non_zero_values])
        )
        octave = h // 12
        n = h % 12
        note = note_names[n] + str(octave)
        error = sum([
            abs(12 * math.log2(freq / C0) - ideal_offset - h)
            for freq in non_zero_values
        ])
        return error, note



def get_quantization_and_error(pitch_outputs_and_rests, predictions_per_eighth,
                              prediction_start_offset, ideal_offset):
    """Calculates quantization error and extracts notes and rests.
    Args:
        pitch_outputs_and_rests (list): List of pitch values and rests.
        predictions_per_eighth (int): Number of predictions per eighth note.
        prediction_start_offset (int): Offset for the start of the prediction.
        ideal_offset (float): Ideal offset value.
    Returns:
        tuple: (quantization_error, notes_and_rests) where
            quantization_error (float): The total quantization error.
            notes_and_rests (list): List of quantized notes and rests.
    """
    pitch_outputs_and_rests = [0] * prediction_start_offset + pitch_outputs_and_rests
    groups = [
        pitch_outputs_and_rests[i:i + predictions_per_eighth]
        for i in range(0, len(pitch_outputs_and_rests), predictions_per_eighth)
    ]
    quantization_error = 0
    notes_and_rests = []
    for group in groups:
        error, note_or_rest = quantize_predictions(group, ideal_offset)
        quantization_error += error
        notes_and_rests.append(note_or_rest)
    return quantization_error, notes_and_rests



def create_sheet_music(best_notes_and_rests, best_predictions_per_note):
    """Creates a sheet music file from the extracted notes and rests.
    Args:
        best_notes_and_rests (list): List of best quantized notes and rests.
        best_predictions_per_note (int): Number of predictions per note.
    Returns:
        str: Path to the generated sheet music file.
    """
    try:
        sc = music21.stream.Score()
        bpm = 60 * 60 / best_predictions_per_note
        a = music21.tempo.MetronomeMark(number=bpm)
        sc.insert(0, a)
        for snote in best_notes_and_rests:
            d = 'half'
            if snote == 'Rest':
                sc.append(music21.note.Rest(type=d))
            else:
                sc.append(music21.note.Note(snote, type=d))
        sheet_music_file = os.path.join(UPLOAD_FOLDER, 'sheet_music.xml')
        sc.write('musicxml', fp=sheet_music_file)
        return sheet_music_file
    except Exception as e:
        raise Exception(f"Error creating sheet music: {e}")



@app.route('/upload', methods=['POST'])
def upload():
    """Handles audio file upload, processing, and saving of results, using sessions.
    Returns:
        jsonify: A JSON response with the processing status or error message.
    """
    if 'audio' not in request.files:
        error_message = "No audio file provided in the request."
        print(error_message)
        return jsonify({'error': error_message}), 400

    if 'audio_uid' not in request.form:
        error_message = "No audio_uid provided in the request."
        print(error_message)
        return jsonify({'error': error_message}), 400

    audio_uid = request.form['audio_uid']
    print(f"Received audio_uid: {audio_uid}")

    if 'user_id' not in session:
        session['user_id'] = os.urandom(16).hex()
        print(f"Generated new user ID: {session['user_id']}")
    user_id = session['user_id']

    if 'processing' in session and session['processing']:
        error_message = "Audio processing is already in progress for this user. Please wait."
        print(error_message)
        return jsonify({'error': error_message}), 400

    session['processing'] = True
    session['audio_uid'] = audio_uid  # Store audio_uid in session
    session['subtitles_data'] = [["start", "end", "note"]]

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    user_upload_folder = os.path.join(UPLOAD_FOLDER, f'user_{user_id}', f'upload_{timestamp}')
    os.makedirs(user_upload_folder, exist_ok=True)
    print(f"Created user upload folder: {user_upload_folder}")

    file = request.files['audio']
    original_filename = secure_filename(file.filename)
    original_path = os.path.join(user_upload_folder, original_filename)
    try:
        file.save(original_path)
        print(f"Saved original audio to {original_path}")

        converted_path = os.path.join(user_upload_folder, 'converted_audio.wav')
        convert_audio_for_model(original_path, converted_path)
        print(f"Converted audio to {converted_path}")

        sample_rate, audio_samples = wavfile.read(converted_path)
        audio_samples = audio_samples.astype(np.float32) / MAX_ABS_INT16

        duration = len(audio_samples) / sample_rate
        print(f'Sample rate: {sample_rate} Hz')
        print(f'Duration: {duration:.2f} s')
        print(f'Size of input: {len(audio_samples)} samples')

        plot_waveform(audio_samples, os.path.join(user_upload_folder, 'waveform.png'))
        print(f"Saved waveform plot to {os.path.join(user_upload_folder, 'waveform.png')}")
        plot_stft(audio_samples, sample_rate, os.path.join(user_upload_folder, 'spectrogram.png'))
        print(f"Saved spectrogram plot to {os.path.join(user_upload_folder, 'spectrogram.png')}")

        model_input = tf.constant(audio_samples, dtype=tf.float32)
        output = spice_model.signatures["serving_default"](model_input)

        pitch = output['pitch'].numpy().flatten()
        confidence = (1.0 - output['uncertainty'].numpy().flatten())

        plot_pitch_confidence(pitch, confidence, os.path.join(user_upload_folder, 'pitch_confidence.png'))
        print(f"Saved pitch and confidence plot to {os.path.join(user_upload_folder, 'pitch_confidence.png')}")
        plot_confident_pitches(pitch, confidence, os.path.join(user_upload_folder, 'confident_pitch.png'))
        print(f"Saved confident pitches plot to {os.path.join(user_upload_folder, 'confident_pitch.png')}")

        indices = range(len(pitch))
        pitch_outputs_and_rests = [
            output2hz(p) if c >= 0.9 else 0
            for i, p, c in zip(indices, pitch, confidence)
        ]

        offsets = [hz2offset(p) for p in pitch_outputs_and_rests if p != 0]
        ideal_offset = statistics.mean(offsets) if offsets else 0
        print("Ideal offset:", ideal_offset)

        best_error = float("inf")
        best_notes_and_rests = None
        best_predictions_per_note = None

        for predictions_per_note in range(20, 65):
            for prediction_start_offset in range(predictions_per_note):
                error, notes_and_rests = get_quantization_and_error(
                    pitch_outputs_and_rests, predictions_per_note,
                    prediction_start_offset, ideal_offset)

                if error < best_error:
                    best_error = error
                    best_notes_and_rests = notes_and_rests
                    best_predictions_per_note = predictions_per_note

        subtitles_data = [["start", "end", "note"]]
        for i, note in enumerate(best_notes_and_rests):
            start = i * (duration / len(best_notes_and_rests))
            end = (i + 1) * (duration / len(best_notes_and_rests))
            subtitles_data.append([start, end, note])

        session['subtitles_data'] = subtitles_data
        session['duration'] = duration
        session['num_notes'] = len(best_notes_and_rests)

        # Save CSV to a temporary file
        csv_filename = f"subtitles_{audio_uid}.csv"
        with tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix='.csv', newline='') as csv_file:
            csv_path = csv_file.name
            print(f"Temporary CSV file created at {csv_path}")
            csv_writer = csv.writer(csv_file)
            csv_writer.writerows(subtitles_data)
            csv_file.flush()
            # Store the path and timestamp in the global dictionary
            AUDIO_UID_TO_CSV_PATH[audio_uid] = (csv_path, datetime.datetime.now())
            print(f"CSV file path and timestamp saved to AUDIO_UID_TO_CSV_PATH: {AUDIO_UID_TO_CSV_PATH}")

        session['csv_file_path'] = csv_path  # save the path in session.  This is no longer needed, but I am leaving it.

        session['processing'] = False
        return jsonify({
            'message': f'Audio processed for user {user_id}.',
            'audio_uid': audio_uid
        })

    except Exception as e:
        error_message = f"Exception in upload: {str(e)}\n{traceback.format_exc()}"
        print(error_message)
        session['processing'] = False
        return jsonify({'error': 'Audio processing failed: ' + str(e)}), 500



@app.route('/download_csv/<audio_uid>', methods=['GET'])
def download_csv(audio_uid):
    """
    Sends the CSV file to the client for download.
    Args:
        audio_uid (str): The unique ID of the audio file.
    Returns:
        Response: The CSV file as a downloadable attachment, or an error.
    """
    print(f"Received request to download CSV for audio_uid: {audio_uid}")

    # Use the global dictionary to get the CSV file path
    csv_file_data = AUDIO_UID_TO_CSV_PATH.get(audio_uid)
    print(f"CSV file data from AUDIO_UID_TO_CSV_PATH: {csv_file_data}")

    if not csv_file_data:
        error_message = f"CSV file not found for audio_uid: {audio_uid}."
        print(error_message)
        return jsonify({'error': error_message}), 404

    csv_file_path, _ = csv_file_data
    csv_filename = os.path.basename(csv_file_path)

    print(f"CSV file path: {csv_file_path}")
    print(f"CSV file name: {csv_filename}")

    try:
        return send_file(
            csv_file_path,
            as_attachment=True,
            download_name=csv_filename,
            mimetype='text/csv'
        )
    except Exception as e:
        error_message = f"Error sending CSV file: {str(e)}\n{traceback.format_exc()}"
        print(error_message)
        return jsonify({'error': 'Error sending CSV file: ' + str(e)}), 500



@app.route('/test-hello', methods=['GET'])
def test_hello():
    """Test endpoint to check if the server is running.
    Returns:
        jsonify: A JSON response with a test message.
    """
    return jsonify({"message": "Test endpoint"})



def cleanup_expired_csvs():
    """
    Cleans up expired CSV files and removes their entries from the global dictionary.
    This function runs periodically to ensure that temporary files do not accumulate indefinitely.
    """
    while True:
        now = datetime.datetime.now()
        expired_files = []
        for audio_uid, (file_path, timestamp) in AUDIO_UID_TO_CSV_PATH.items():
            if (now - timestamp).total_seconds() > 600:  # 10 minutes = 600 seconds
                expired_files.append(audio_uid)

        for audio_uid in expired_files:
            file_path = AUDIO_UID_TO_CSV_PATH[audio_uid][0]
            try:
                os.remove(file_path)
                print(f"Deleted expired CSV file: {file_path}")
            except Exception as e:
                print(f"Error deleting expired CSV file {file_path}: {e}")
            del AUDIO_UID_TO_CSV_PATH[audio_uid]
            print(f"Removed expired CSV entry {audio_uid} from AUDIO_UID_TO_CSV_PATH")

        time.sleep(600)  # Check every 10 minutes



if __name__ == '__main__':
    # Start the cleanup thread
    cleanup_thread = threading.Thread(target=cleanup_expired_csvs)
    cleanup_thread.daemon = True  # The thread will exit when the main application exits
    cleanup_thread.start()
    app.run(debug=True, port=5000)
