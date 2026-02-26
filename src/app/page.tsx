'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { NVIDIA_MODELS } from '../lib/models';

interface ProcessStep {
  id: string;
  title: string;
  status: 'pending' | 'active' | 'completed' | 'error';
}

interface CodebookVariable {
  id: string;
  name: string;
  scale: number | string;
  reason: string;
}

interface AnalysisResult {
  imageAnalysis?: string;
  codebook: CodebookVariable[];
}

interface ExtractionData {
  videoPath: string;
  videoBase64: string;
  audioPath: string;
  frames: string[];
  duration: number;
  reelDescription: string;
  reelTitle: string;
  uploaderName: string;
  originalUrl: string;
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [steps, setSteps] = useState<ProcessStep[]>([
    { id: 'extract', title: 'Video & Audio Extraction', status: 'pending' },
    { id: 'transcribe', title: 'Speech-to-Text Transcription', status: 'pending' },
    { id: 'frames', title: 'Visual Frame Extraction', status: 'pending' },
    { id: 'analyze', title: 'AI Manipulation Analysis', status: 'pending' },
  ]);
  const [transcription, setTranscription] = useState<string>('');
  const [frames, setFrames] = useState<string[]>([]);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoBase64, setVideoBase64] = useState<string>('');
  const [reelDescription, setReelDescription] = useState<string>('');
  const [reelTitle, setReelTitle] = useState<string>('');
  const [uploaderName, setUploaderName] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('cerebras-native');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>('');

  const updateStepStatus = (stepId: string, status: ProcessStep['status']) => {
    setSteps(prev => prev.map(step =>
      step.id === stepId ? { ...step, status } : step
    ));
  };

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stepId)) {
        newSet.delete(stepId);
      } else {
        newSet.add(stepId);
      }
      return newSet;
    });
  };

  const getWordCount = (text: string) => {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const handleAnalyze = async () => {
    if (!url.trim()) return;

    setIsAnalyzing(true);
    setError('');
    setTranscription('');
    setFrames([]);
    setVideoDuration(0);
    setVideoBase64('');
    setReelDescription('');
    setReelTitle('');
    setUploaderName('');
    setAnalysisResult(null);
    setSteps(prev => prev.map(step => ({ ...step, status: 'pending' })));

    try {
      // Step 1: Extract video and audio
      updateStepStatus('extract', 'active');
      const extractResponse = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!extractResponse.ok) {
        const errorData = await extractResponse.json();
        throw new Error(errorData.error || 'Failed to extract video');
      }

      const extractData: ExtractionData = await extractResponse.json();
      updateStepStatus('extract', 'completed');
      setFrames(extractData.frames);
      setVideoDuration(extractData.duration);
      setVideoBase64(extractData.videoBase64);
      setReelDescription(extractData.reelDescription);
      setReelTitle(extractData.reelTitle);
      setUploaderName(extractData.uploaderName);

      // Step 2: Transcribe audio
      updateStepStatus('transcribe', 'active');
      const transcribeResponse = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: extractData.audioPath }),
      });

      if (!transcribeResponse.ok) {
        const errorData = await transcribeResponse.json();
        throw new Error(errorData.error || 'Failed to transcribe audio');
      }

      const transcribeData = await transcribeResponse.json();
      setTranscription(transcribeData.transcription);
      updateStepStatus('transcribe', 'completed');
      updateStepStatus('frames', 'completed');

      // Step 3: AI Analysis (includes reel description)
      updateStepStatus('analyze', 'active');
      const analyzeResponse = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcription: transcribeData.transcription,
          frames: extractData.frames,
          reelDescription: extractData.reelDescription,
          url,
          duration: extractData.duration,
          uploaderName: extractData.uploaderName,
          reelTitle: extractData.reelTitle,
          model: selectedModel
        }),
      });

      if (!analyzeResponse.ok) {
        const errorData = await analyzeResponse.json();
        throw new Error(errorData.error || 'Failed to analyze content');
      }

      const analysisData = await analyzeResponse.json();
      setAnalysisResult(analysisData);
      updateStepStatus('analyze', 'completed');

    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      setSteps(prev => prev.map(step =>
        step.status === 'active' ? { ...step, status: 'error' } : step
      ));
    } finally {
      setIsAnalyzing(false);
    }
  };



  return (
    <div className="app-container">
      {/* Left Panel - Input & Processing */}
      <div className="left-panel">
        <header className="header">
          <h1 style={{ marginBottom: '0.5rem' }}>Manipulation Detection in Influencer Marketing</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <p style={{ margin: 0, opacity: 0.8 }}>Project led by Dr. Huan Chen</p>
            <div className="model-selector-wrapper" style={{ minWidth: '200px' }}>
              <select 
                className="model-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isAnalyzing}
                style={{
                  padding: '0.4rem 0.8rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  outline: 'none',
                  width: 'auto',
                  maxWidth: '300px'
                }}
              >
                <option value="cerebras-native">⚡ Cerebras GPT-OSS-120B (Native)</option>
                <optgroup label="Nvidia NIM Models">
                  {NVIDIA_MODELS.map(model => (
                    <option key={model} value={model}>{model.split('/').pop()}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
        </header>

        <div className="url-section">


          <div className="input-wrapper">
            <input
              type="text"
              className="url-input"
              placeholder="Paste Instagram Reel URL..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isAnalyzing}
            />
            <button
              className="analyze-btn"
              onClick={handleAnalyze}
              disabled={isAnalyzing || !url.trim()}
            >
              {isAnalyzing ? (
                <>
                  <span className="spinner"></span>
                  Analyzing...
                </>
              ) : (
                '🚀 Analyze'
              )}
            </button>
          </div>
        </div>

        <div className="left-content">
          {/* Process Steps */}
          <div className="process-steps">
            {steps.map((step) => (
              <div key={step.id} className={`process-step ${step.status}`}>
                <div className={`step-icon ${step.status}`}>
                  {step.status === 'pending' && '○'}
                  {step.status === 'active' && '◐'}
                  {step.status === 'completed' && '✓'}
                  {step.status === 'error' && '✕'}
                </div>
                <span className="step-title">{step.title}</span>
              </div>
            ))}
          </div>

          {/* Video Info */}
          {videoDuration > 0 && (
            <div className="video-info">
              <span className="info-badge">🎬 Duration: {formatDuration(videoDuration)}</span>
              {transcription && (
                <span className="info-badge">📝 Words: {getWordCount(transcription)}</span>
              )}
              <span className="info-badge">🖼️ Frames: {frames.length}</span>
              {uploaderName && (
                <span className="info-badge">👤 {uploaderName}</span>
              )}
            </div>
          )}

          {/* Reel Video & Description - Side by Side */}
          {(videoBase64 || reelDescription) && (
            <div className="content-section">
              <div className="reel-headers">
                <h3 className="section-heading reel-heading">📹 Instagram Reel</h3>
                {reelDescription && (
                  <h3 className="section-heading reel-heading">📝 Caption</h3>
                )}
              </div>
              <div className="reel-container">
                {videoBase64 && (
                  <div className="reel-video-wrapper">
                    <video
                      controls
                      className="reel-video"
                      src={videoBase64}
                      poster={frames[0] || undefined}
                    >
                      Your browser does not support video playback.
                    </video>
                  </div>
                )}
                {reelDescription && (
                  <div className="reel-description-wrapper">
                    <div className="reel-description">
                      {reelDescription}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Transcription */}
          {transcription && (
            <div className="content-section">
              <h3 className="section-heading">🎙️ Audio Transcription</h3>
              <div className="transcription-full">
                {transcription}
              </div>
            </div>
          )}

          {/* Frame Gallery */}
          {frames.length > 0 && (
            <div className="content-section">
              <h3 className="section-heading">🎬 Extracted Frames ({frames.length} evenly-spaced frames)</h3>
              <div className="frame-grid-full">
                {frames.map((frame, index) => (
                  <div key={index} className="frame-thumb">
                    <img src={frame} alt={`Frame ${index + 1}`} />
                    <span className="frame-num">{index + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Visual Analysis */}
          {analysisResult?.imageAnalysis && (
            <div className="content-section">
              <h3 className="section-heading">Visual Content Analysis</h3>
              <div className="visual-analysis-full">
                <MarkdownContent content={analysisResult.imageAnalysis} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Results */}
      <div className="right-panel">
        <div className="result-header">
          <h2>Analysis Results</h2>
        </div>

        <div className="result-content">
          {error && (
            <div className="error-card">
              <h4>⚠️ Error</h4>
              <p>{error}</p>
            </div>
          )}

          {!analysisResult && !error && (
            <div className="empty-state">
              <div className="empty-state-icon">🔬</div>
              <h3>No Analysis Yet</h3>
              <p>Enter an Instagram Reel URL and click Analyze to detect manipulation tactics</p>
            </div>
          )}

          {analysisResult?.codebook && (
            <div className="codebook-results-container" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>Codebook Analysis</h3>
              {analysisResult.codebook.map((item, index) => (
                <div key={index} className="codebook-item" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '1.25rem', borderTop: '3px solid var(--primary-accent)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <h4 style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '1.1rem' }}>{item.id}: {item.name}</h4>
                    <span style={{ background: 'var(--primary-accent)', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                      Scale: {item.scale}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.95rem', color: 'rgba(255, 255, 255, 0.85)', lineHeight: 1.5 }}>
                    {item.reason}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
