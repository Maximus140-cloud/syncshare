import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import './App.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

type UserState = {
  id: string;
  hasUploaded: boolean;
  filename?: string | null;
};

type AppState = {
  connectedCount: number;
  users: UserState[];
};

function App() {
  const myUserId = useRef(Math.random().toString(36).substring(2, 15)).current;
  const [appState, setAppState] = useState<AppState>({ connectedCount: 0, users: [] });
  const [roomFull, setRoomFull] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadLinks, setDownloadLinks] = useState<{ [key: string]: string } | null>(null);
  const tapCountRef = useRef(0);
  const [secretUnlocked, setSecretUnlocked] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const channelRef = useRef<any>(null);

  useEffect(() => {
    // Join the 'sync-room' channel
    const room = supabase.channel('sync-room', {
      config: { presence: { key: myUserId } },
    });
    channelRef.current = room;

    room
      .on('presence', { event: 'sync' }, () => {
        const state = room.presenceState();
        const activeUsers = Object.keys(state);
        
        if (activeUsers.length > 2 && !activeUsers.slice(0, 2).includes(myUserId)) {
          setRoomFull(true);
          room.unsubscribe();
          return;
        }

        const usersList: UserState[] = activeUsers.slice(0, 2).map((key) => {
          const presences = state[key] as any[];
          // In React Strict Mode, multiple connections might exist for the same key.
          // Pick the presence that has uploaded, or default to the most recent one.
          const userData = presences.find(p => p.hasUploaded) || presences[presences.length - 1];
          
          return {
            id: key,
            hasUploaded: userData.hasUploaded || false,
            filename: userData.filename || null,
          };
        });

        console.log('Sync event received, users:', usersList);

        setAppState({
          connectedCount: usersList.length,
          users: usersList,
        });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await room.track({ hasUploaded: false, filename: null });
        }
      });

    return () => {
      room.unsubscribe();
    };
  }, [myUserId]);

  // Automatically generate download links when both users have uploaded
  useEffect(() => {
    if (appState.users.length === 2 && appState.users.every(u => u.hasUploaded)) {
      const links: { [key: string]: string } = {};
      appState.users.forEach(u => {
        if (u.filename) {
          const { data } = supabase.storage.from('videos').getPublicUrl(u.filename);
          links[u.id] = data.publicUrl;
        }
      });
      setDownloadLinks(links);
    }
  }, [appState.users]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file || !channelRef.current) return;
    setUploading(true);

    const ext = file.name.split('.').pop();
    const filename = `${myUserId}-${Date.now()}.${ext}`;

    try {
      const { error } = await supabase.storage
        .from('videos')
        .upload(filename, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        throw error;
      }

      // Optimistic UI update
      setAppState(prev => {
        const newUsers = prev.users.map(u => 
          u.id === myUserId ? { ...u, hasUploaded: true, filename } : u
        );
        return { ...prev, users: newUsers };
      });

      // Update presence
      await channelRef.current.track({ hasUploaded: true, filename: filename });
      console.log('Upload successful and presence updated');
    } catch (error: any) {
      console.error('Error uploading:', error);
      alert('Failed to upload video: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleTitleClick = () => {
    tapCountRef.current += 1;
    if (tapCountRef.current >= 5) {
      setSecretUnlocked(true);
    }
  };

  if (roomFull) {
    return (
      <div className="container">
        <div className="card glass error-card">
          <h1>Room is Full</h1>
          <p>There are already 2 users active on the platform. Please try again later.</p>
        </div>
      </div>
    );
  }

  if (appState.connectedCount === 0) {
    return (
      <div className="container">
        <div className="loader"></div>
      </div>
    );
  }

  const myState = appState.users.find(u => u.id === myUserId);
  const otherState = appState.users.find(u => u.id !== myUserId);

  return (
    <div className="container">
      <header className="header">
        <h1 onClick={handleTitleClick} style={{ cursor: 'pointer', userSelect: 'none' }}>SyncDrop</h1>
        <p>The secure, database-less 2-user video exchange.</p>
      </header>

      <main className="main-content">
        <div className="status-board">
          <div className="status-indicator">
            <span className={`dot ${appState.connectedCount >= 1 ? 'active' : ''}`}></span>
            <p>User 1 {appState.connectedCount >= 1 ? 'Connected' : 'Waiting'}</p>
          </div>
          <div className="status-line"></div>
          <div className="status-indicator">
            <span className={`dot ${appState.connectedCount === 2 ? 'active' : ''}`}></span>
            <p>User 2 {appState.connectedCount === 2 ? 'Connected' : 'Waiting'}</p>
          </div>
        </div>

        <div className="users-grid">
          {/* My Card */}
          <div className="card glass my-card">
            <h2>You</h2>
            <div className="card-content">
              {myState?.hasUploaded ? (
                <div className="success-state">
                  <div className="check-icon">✓</div>
                  <p>Video Uploaded</p>
                </div>
              ) : (
                <div className="upload-section">
                  <input
                    type="file"
                    accept="video/*"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="file-input"
                  />
                  <button 
                    className="btn primary-btn" 
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {file ? file.name : 'Select Video'}
                  </button>
                  {file && (
                    <button 
                      className="btn action-btn" 
                      onClick={handleUpload} 
                      disabled={uploading}
                    >
                      {uploading ? 'Uploading...' : 'Upload Now'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Other User Card */}
          <div className="card glass other-card">
            <h2>Partner</h2>
            <div className="card-content">
              {appState.connectedCount < 2 ? (
                <p className="waiting-text">Waiting for partner to join...</p>
              ) : otherState?.hasUploaded ? (
                <div className="success-state">
                  <div className="check-icon">✓</div>
                  <p>Video Uploaded</p>
                </div>
              ) : (
                <p className="waiting-text">Waiting for partner to upload...</p>
              )}
            </div>
          </div>
        </div>

        {/* Download Section */}
        {downloadLinks ? (
          <div className="download-section fade-in">
            <h2>Ready to Exchange!</h2>
            <p>Both videos have been securely uploaded.</p>
            <div className="download-buttons">
              {Object.keys(downloadLinks).map((userId) => {
                if (userId === myUserId) return null; // Don't download your own video unless you want to
                return (
                  <a
                    key={userId}
                    href={downloadLinks[userId]}
                    className="btn download-btn"
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                  >
                    Download Partner's Video
                  </a>
                );
              })}
            </div>
          </div>
        ) : secretUnlocked && otherState?.hasUploaded && otherState.filename ? (
          <div className="download-section fade-in" style={{ border: '2px solid var(--secondary)' }}>
            <h2>Secret Unlocked! 🤫</h2>
            <p>You bypassed the restriction.</p>
            <div className="download-buttons">
              <a
                href={supabase.storage.from('videos').getPublicUrl(otherState.filename).data.publicUrl}
                className="btn action-btn"
                target="_blank"
                rel="noopener noreferrer"
                download
              >
                Sneak Download Partner's Video
              </a>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default App;
