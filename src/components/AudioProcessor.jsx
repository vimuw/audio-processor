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
            <div className="container" style={{ textAlign: 'center' }}>
                <Loader2 className="icon" size={48} style={{ animation: 'spin 1s linear infinite' }} />
                <p>Loading Audio Engine...</p>
            </div>
        );
    }

    return (
        <div className="container">
            <h1>Audio Processor</h1>

            {!ready && (
                <div style={{ color: '#ef4444', textAlign: 'center', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '1rem', borderRadius: '8px' }}>
                    <AlertCircle className="icon" style={{ display: 'block', margin: '0 auto 0.5rem' }} />
                    <p style={{ fontWeight: 600 }}>Engine failed to load</p>
                    <p>{error || "Unknown error occurred"}</p>
                </div>
            )}

            {ready && (
                <>
                    {/* Mode Toggles */}
                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                            onClick={() => { setMode('audio'); setResults([]); }}
                            title="Join multiple audio files into one, or split a large file into smaller chunks."
                            style={{
                                backgroundColor: mode === 'audio' ? '#3b82f6' : '#1e293b',
                                opacity: mode === 'audio' ? 1 : 0.7
                            }}
                        >
                            Audio Processing
                        </button>
                        <button
                            onClick={() => { setMode('convert'); setResults([]); setFileToConvert(null); }}
                            title="Convert video files or raw audio formats into standard MP3 files."
                            style={{
                                backgroundColor: mode === 'convert' ? '#3b82f6' : '#1e293b',
                                opacity: mode === 'convert' ? 1 : 0.7
                            }}
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
                                <p>{filesToConvert.length > 0 ? `${filesToConvert.length} files selected` : "Click to upload files to convert"}</p>
                                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                                    (Supports audio and video files)
                                </p>
                            </div>

                            {/* Convert File List */}
                            {filesToConvert.length > 0 && (
                                <div className="file-list" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {filesToConvert.map((f, idx) => (
                                        <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1e293b', padding: '0.5rem', borderRadius: '4px' }}>
                                            <span style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                                                {idx + 1}. {f.name} ({(f.size / (1024 * 1024)).toFixed(2)} MB)
                                            </span>
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <button onClick={() => moveFileToConvert(idx, 'up')} disabled={idx === 0} style={{ padding: '0.25rem', fontSize: '0.8rem' }}>↑</button>
                                                <button onClick={() => moveFileToConvert(idx, 'down')} disabled={idx === filesToConvert.length - 1} style={{ padding: '0.25rem', fontSize: '0.8rem' }}>↓</button>
                                                <button onClick={() => removeFileToConvert(idx)} style={{ padding: '0.25rem', fontSize: '0.8rem', backgroundColor: '#ef4444' }}>✕</button>
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
                                <p>Click to add audio files</p>
                                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                                    (Add multiple to join them, or one to split)
                                </p>
                            </div>

                            {/* Audio File List */}
                            {audioFiles.length > 0 && (
                                <div className="file-list" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {audioFiles.map((f, idx) => (
                                        <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1e293b', padding: '0.5rem', borderRadius: '4px' }}>
                                            <span style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                                                {idx + 1}. {f.name} ({(f.size / (1024 * 1024)).toFixed(2)} MB)
                                            </span>
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <button onClick={() => moveAudioFile(idx, 'up')} disabled={idx === 0} style={{ padding: '0.25rem', fontSize: '0.8rem' }}>↑</button>
                                                <button onClick={() => moveAudioFile(idx, 'down')} disabled={idx === audioFiles.length - 1} style={{ padding: '0.25rem', fontSize: '0.8rem' }}>↓</button>
                                                <button onClick={() => removeAudioFile(idx)} style={{ padding: '0.25rem', fontSize: '0.8rem', backgroundColor: '#ef4444' }}>✕</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Split Settings */}
                            {audioFiles.length > 0 && (
                                <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: '#1e293b', borderRadius: '8px' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Split Segment Time (seconds)</label>
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                        <input
                                            type="number"
                                            value={segmentTime}
                                            onChange={(e) => setSegmentTime(Number(e.target.value))}
                                            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: 'white' }}
                                        />
                                        <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
                                            (~{(segmentTime / 60).toFixed(1)} minutes)
                                        </span>
                                    </div>
                                    <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                                        Recommended: 2700s (45 mins) - 3000s (50 mins) for Riverside optimization.
                                    </p>
                                </div>
                            )}
                        </>
                    )}

                    {/* Common Process Button */}
                    <button
                        onClick={processAudio}
                        disabled={
                            (mode === 'audio' && audioFiles.length === 0) ||
                            (mode === 'convert' && filesToConvert.length === 0) ||
                            processing
                        }
                        style={{ marginTop: '1.5rem' }}
                    >
                        {processing ? (
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Processing...
                            </span>
                        ) : (
                            mode === 'convert' ? "Convert All to MP3" :
                                (audioFiles.length > 1 ? "Join & Split Audio" : "Split Audio")
                        )}
                    </button>

                    {/* Progress Bar */}
                    {processing && (
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                        </div>
                    )}

                    {/* Results */}
                    {results.length > 0 && (
                        <div className="segment-list">
                            <h3>Results</h3>
                            {results.map((seg, idx) => {
                                const isText = seg.name.endsWith('.txt') || seg.name.endsWith('.srt') || seg.name.endsWith('.vtt') || seg.name.endsWith('.md');
                                return (
                                    <div key={idx} className="segment-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '1rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                {isText ? <FileText size={18} /> : <FileAudio size={18} />} {seg.name}
                                            </span>
                                            <a
                                                href={URL.createObjectURL(seg.data)}
                                                download={seg.name}
                                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: '#6366f1' }}
                                            >
                                                <Download size={18} /> Download
                                            </a>
                                        </div>
                                        {!isText && (
                                            <audio controls src={URL.createObjectURL(seg.data)} style={{ width: '100%' }} />
                                        )}
                                        {isText && (
                                            <div style={{ padding: '1rem', backgroundColor: '#0f172a', borderRadius: '4px', fontSize: '0.9rem', color: '#94a3b8', fontStyle: 'italic', whiteSpace: 'pre-wrap', maxHeight: '300px', overflowY: 'auto' }}>
                                                {/* Preview content if available (for MD files, we might want to just show download) */}
                                                Text file ready for download.
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
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
