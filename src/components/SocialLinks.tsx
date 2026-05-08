import React from 'react';
import './SocialLinks.css';

const SocialLinks: React.FC = () => {
  return (
    <footer className="social-links">
      <div className="glass-card">
        <h3>Connect with 星ノ座</h3>
        <div className="links-container">
          <a href="https://www.youtube.com/channel/UCJZnKoctpCvwRFDoYNoLnjA" target="_blank" rel="noopener noreferrer" className="link-item youtube">
            YouTube
          </a>
          <a href="https://x.com/hoshinoza" target="_blank" rel="noopener noreferrer" className="link-item x">
            X (Twitter)
          </a>
          <a href="https://www.nicovideo.jp/user/97505658/video" target="_blank" rel="noopener noreferrer" className="link-item niconico">
            NicoNico
          </a>
        </div>
        <p className="copyright">&copy; {new Date().getFullYear()} 星ノ座 (Hoshinoza)</p>
      </div>
    </footer>
  );
};

export default SocialLinks;
