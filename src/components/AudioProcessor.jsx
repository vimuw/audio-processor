import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ffmpegHelper } from '../utils/ffmpegHelper';
import { Upload, FileAudio, FileText, CheckCircle, AlertCircle, Loader2, Download, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

export default function AudioProcessor() {
    const [ready, setReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);

    // Modes: 'audio' (unified split/join), 'convert' (mp3 conversion)
    const [mode, setMode] = useState('audio');

    // Audio State
    const [audioFiles, setAudioFiles] = useState([]);
    const [filesToConvert, setFilesToConvert] = useState([]); // For convert mode (batch)
    const [segmentTime, setSegmentTime] = useState(2500); // Default ~45 mins (safe for Riverside)
    const [totalDuration, setTotalDuration] = useState(null);

    // Shared State
    const [logs, setLogs] = useState([]);
    const [progress, setProgress] = useState(0);
    const [results, setResults] = useState([]);
    const [error, setError] = useState(null);

    const logsEndRef = useRef(null);

    useEffect(() => {
        const load = async () => {
            try {
                await ffmpegHelper.load((msg) => {
                    setLogs(prev => [...prev, msg]);
                });
                setReady(true);
            } catch (err) {
                console.error(err);
                setError(`Failed to load FFmpeg: ${err.message}`);
                setLogs(prev => [...prev, `Error: ${err.message}`]);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    // --- Audio Handlers ---

    const handleAudioFileChange = (e) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const newFiles = Array.from(e.target.files);
        setResults([]);
        setProgress(0);
        setError(null);
        setLogs([]);

        if (mode === 'convert') {
            setFilesToConvert(prev => [...prev, ...newFiles]);
        } else {
            // Audio mode
            setAudioFiles(prev => [...prev, ...newFiles]);
            // If it's the first file, calculate generic duration for suggestion
            if (audioFiles.length === 0 && newFiles.length === 1) {
                const audio = new Audio(URL.createObjectURL(newFiles[0]));
                audio.onloadedmetadata = () => {
                    setTotalDuration(audio.duration);
                    URL.revokeObjectURL(audio.src);
                };
            }
        }
    };

    const moveAudioFile = (index, direction) => {
        const newFiles = [...audioFiles];
        if (direction === 'up' && index > 0) {
            [newFiles[index], newFiles[index - 1]] = [newFiles[index - 1], newFiles[index]];
        } else if (direction === 'down' && index < newFiles.length - 1) {
            [newFiles[index], newFiles[index + 1]] = [newFiles[index + 1], newFiles[index]];
        }
        setAudioFiles(newFiles);
    };

    const removeAudioFile = (index) => {
        setAudioFiles(audioFiles.filter((_, i) => i !== index));
    };

    const moveFileToConvert = (index, direction) => {
        const newFiles = [...filesToConvert];
        if (direction === 'up' && index > 0) {
            [newFiles[index], newFiles[index - 1]] = [newFiles[index - 1], newFiles[index]];
        } else if (direction === 'down' && index < newFiles.length - 1) {
            [newFiles[index], newFiles[index + 1]] = [newFiles[index + 1], newFiles[index]];
        }
        setFilesToConvert(newFiles);
    };

    const removeFileToConvert = (index) => {
        setFilesToConvert(filesToConvert.filter((_, i) => i !== index));
    };

    // --- Processing ---

    const processAudio = async () => {
        if (mode === 'audio' && audioFiles.length === 0) return;
        if (mode === 'convert' && filesToConvert.length === 0) return;

        setProcessing(true);
        setProgress(0);
        setLogs([]);
        setError(null);
        setResults([]);

        try {
            if (mode === 'convert') {
                const totalFiles = filesToConvert.length;
                const newResults = [];

                for (let i = 0; i < totalFiles; i++) {
                    const file = filesToConvert[i];
                    setLogs(prev => [...prev, `Converting file ${i + 1} of ${totalFiles}: ${file.name}...`]);

                    const output = await ffmpegHelper.convertToMp3(file, ({ progress }) => {
                        // Calculate overall progress: (completed files + current file progress) / total files
                        const overallProgress = ((i + progress) / totalFiles) * 100;
                        setProgress(Math.round(overallProgress));
                    });

                    newResults.push(...output);
                }
                setResults(newResults);
                setLogs(prev => [...prev, "All files converted successfully."]);
                setProgress(100);

            } else if (mode === 'audio') {
                let fileToSplit;

                // 1. Join if multiple files
                if (audioFiles.length > 1) {
                    setLogs(prev => [...prev, "Joining audio files..."]);
                    const joined = await ffmpegHelper.joinAudios(audioFiles, ({ progress }) => {
                        setProgress(Math.round(progress * 50)); // First 50% for joining
                    });

                    // The result of joinAudios is [{name, data}]
                    // We need a File object for split
                    const blob = joined[0].data;
                    fileToSplit = new File([blob], "joined_audio.mp3", { type: "audio/mp3" });

                    setLogs(prev => [...prev, "Join complete. Starting split..."]);
                } else {
                    fileToSplit = audioFiles[0];
                }

                // 2. Split
                const output = await ffmpegHelper.convertAndSplit(fileToSplit, segmentTime, ({ progress }) => {
                    // If we joined, map 0-1 to 50-100. If single, map 0-1 to 0-100.
                    const base = audioFiles.length > 1 ? 50 : 0;
                    const scale = audioFiles.length > 1 ? 0.5 : 1;
                    setProgress(base + Math.round(progress * 100 * scale));
                });

                setResults(output);

            }
        } catch (err) {
            console.error(err);
            setError(`Failed to process: ${err.message}`);
            setLogs(prev => [...prev, `Error: ${err.message}`]);
        } finally {
            setProcessing(false);
        }
    };

    if (loading) {
        return (
            <div className="container">
                <div className="loading-box">
                    <Loader2 className="icon spin-icon" size={48} />
                    <p style={{ marginTop: '1rem', fontWeight: 500 }}>Initializing Audio Engine...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <h1>Audio Processor</h1>

            {!ready && (
                <div className="alert-box">
                    <AlertCircle size={32} style={{ margin: '0 auto 0.5rem', display: 'block' }} />
                    <p style={{ fontWeight: 600, margin: '0 0 0.25rem 0' }}>Engine failed to load</p>
                    <p style={{ fontSize: '0.9rem', margin: 0 }}>{error || "Unknown error occurred"}</p>
                </div>
            )}

            {ready && (
                <>
                    {/* Mode Toggles */}
                    {/* Mode Toggles */}
                    <div className="toggle-group">
                        <button
                            className={`toggle-btn ${mode === 'audio' ? 'active' : ''}`}
                            onClick={() => { setMode('audio'); setResults([]); }}
                            title="Join multiple audio files into one, or split a large file into smaller chunks."
                        >
                            Audio Processing
                        </button>
                        <button
                            className={`toggle-btn ${mode === 'convert' ? 'active' : ''}`}
                            onClick={() => { setMode('convert'); setResults([]); setFilesToConvert([]); }}
                            title="Convert video files or raw audio formats into standard MP3 files."
                        >
                            Convert to MP3
                        </button>
                    </div>

                    {/* Convert Mode UI */}
                    {mode === 'convert' && (
                        <>
                            <div className="upload-area" onClick={() => document.getElementById('convert-upload').click()}>
                                <input
                                    type="file"
                                    id="convert-upload"
                                    accept="audio/*,video/*"
                                    multiple
                                    style={{ display: 'none' }}
                                    onChange={handleAudioFileChange}
                                    disabled={processing}
                                />
                                <Upload className="icon" size={48} />
                                <p>{filesToConvert.length > 0 ? `${filesToConvert.length} files selected` : "Drag & drop or click to upload files"}</p>
                                <p className="subtitle">Supports audio and video formats for MP3 conversion</p>
                            </div>

                            {/* Convert File List */}
                            {filesToConvert.length > 0 && (
                                <div className="file-list">
                                    {filesToConvert.map((f, idx) => (
                                        <div key={idx} className="file-item" style={{ animationDelay: `${idx * 0.05}s` }}>
                                            <span className="file-name">
                                                {idx + 1}. {f.name} ({(f.size / (1024 * 1024)).toFixed(2)} MB)
                                            </span>
                                            <div className="action-btn-group">
                                                <button className="icon-btn" onClick={() => moveFileToConvert(idx, 'up')} disabled={idx === 0} title="Move Up"><ArrowUp size={16} /></button>
                                                <button className="icon-btn" onClick={() => moveFileToConvert(idx, 'down')} disabled={idx === filesToConvert.length - 1} title="Move Down"><ArrowDown size={16} /></button>
                                                <button className="icon-btn danger" onClick={() => removeFileToConvert(idx)} title="Remove"><Trash2 size={16} /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* Audio Mode UI */}
                    {mode === 'audio' && (
                        <>
                            <div className="upload-area" onClick={() => document.getElementById('file-upload').click()}>
                                <input
                                    type="file"
                                    id="file-upload"
                                    accept="audio/*"
                                    multiple
                                    style={{ display: 'none' }}
                                    onChange={handleAudioFileChange}
                                    disabled={processing}
                                />
                                <Upload className="icon" size={48} />
                                <p>Drag & drop or click to add audio files</p>
                                <p className="subtitle">Add multiple to join them, or a single file to split it</p>
                            </div>

                            {/* Audio File List */}
                            {audioFiles.length > 0 && (
                                <div className="file-list">
                                    {audioFiles.map((f, idx) => (
                                        <div key={idx} className="file-item" style={{ animationDelay: `${idx * 0.05}s` }}>
                                            <span className="file-name">
                                                {idx + 1}. {f.name} ({(f.size / (1024 * 1024)).toFixed(2)} MB)
                                            </span>
                                            <div className="action-btn-group">
                                                <button className="icon-btn" onClick={() => moveAudioFile(idx, 'up')} disabled={idx === 0} title="Move Up"><ArrowUp size={16} /></button>
                                                <button className="icon-btn" onClick={() => moveAudioFile(idx, 'down')} disabled={idx === audioFiles.length - 1} title="Move Down"><ArrowDown size={16} /></button>
                                                <button className="icon-btn danger" onClick={() => removeAudioFile(idx)} title="Remove"><Trash2 size={16} /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Split Settings */}
                            {audioFiles.length > 0 && (
                                <div className="settings-panel">
                                    <label>Split Segment Time (seconds)</label>
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                        <input
                                            type="number"
                                            value={segmentTime}
                                            onChange={(e) => setSegmentTime(Number(e.target.value))}
                                            min="10"
                                            step="10"
                                        />
                                        <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>
                                            ≈ {(segmentTime / 60).toFixed(1)} minutes per chunk
                                        </span>
                                    </div>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.75rem', marginBottom: 0 }}>
                                        Recommended: 2700s (45 mins) - 3000s (50 mins) for Riverside optimization.
                                    </p>
                                </div>
                            )}
                        </>
                    )}

                    {/* Common Process Button */}
                    <button
                        className="process-btn"
                        onClick={processAudio}
                        disabled={
                            (mode === 'audio' && audioFiles.length === 0) ||
                            (mode === 'convert' && filesToConvert.length === 0) ||
                            processing
                        }
                    >
                        {processing ? (
                            <>
                                <Loader2 className="spin-icon" size={20} />
                                <span>Processing...</span>
                            </>
                        ) : (
                            mode === 'convert' ? "Convert All to MP3" :
                                (audioFiles.length > 1 ? "Join & Split Audio" : "Split Audio")
                        )}
                    </button>

                    {/* Progress Bar */}
                    {processing && (
                        <div className="progress-container">
                            <div className="progress-header">
                                <span>Processing Audio...</span>
                                <span>{progress}%</span>
                            </div>
                            <div className="progress-bar">
                                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>
                    )}

                    {/* Results */}
                    {results.length > 0 && (
                        <>
                            <div className="results-header">
                                <CheckCircle size={28} className="icon" style={{ margin: 0 }} />
                                Processing Complete
                            </div>
                            <div className="segment-list">
                                {results.map((seg, idx) => {
                                    return (
                                        <div key={idx} className="result-card" style={{ animationDelay: `${idx * 0.1}s` }}>
                                            <div className="result-header">
                                                <div className="result-title">
                                                    <FileAudio size={20} color="var(--primary-color)" />
                                                    <span>{seg.name}</span>
                                                </div>
                                                <a
                                                    href={URL.createObjectURL(seg.data)}
                                                    download={seg.name}
                                                    className="download-link"
                                                >
                                                    <Download size={18} /> Download
                                                </a>
                                            </div>
                                            <audio controls src={URL.createObjectURL(seg.data)} />
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    <div className="log-area">
                        {logs.map((log, i) => <div key={i}>{log}</div>)}
                        <div ref={logsEndRef} />
                    </div>
                </>
            )
            }
        </div >
    );
}
