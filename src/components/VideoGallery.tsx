import React from 'react';
import './VideoGallery.css';

const videos = [
  { id: 'GM0q0YYaaF8', title: 'ミッドナイト東京' },
  { id: 'R6Q0Pp0UlXU', title: '硝子の笛' },
];

const VideoGallery: React.FC = () => {
  return (
    <section className="video-gallery">
      <h2>Discography</h2>
      <div className="video-grid">
        {videos.map((video) => (
          <div key={video.id} className="video-item glass-card">
            <div className="video-container">
              <iframe
                src={`https://www.youtube.com/embed/${video.id}`}
                title={video.title}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
            <p className="video-title">{video.title}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default VideoGallery;
