import React from 'react';
import './VideoGallery.css';

const videos = [
  { id: 'bwegfIsyRsI', title: '『リセット・シークエンス』/ ナツメイツキ (Synthesizer V)' },
  { id: 'v12nCVScnuk', title: '『きっと、春』/ 初音ミク' },
  { id: 'UQcfcB4i6es', title: '『時の雨に溺れる』/ 初音ミク' },
  { id: 'Muk7UMyY95Y', title: '『Room_B203』/ 初音ミク' },
  { id: 'oAN61yELIuo', title: '『硝子の笛』/ 初音ミク' },
  { id: 'wdgLdP9KHWE', title: '『アニモシティ』/ 初音ミク' },
  { id: 'prEEoDLF64w', title: '『幽天少女』/ 初音ミク, Merrow' },
  { id: 'F3IIZL-83Dc', title: '"デッドラクター" ／ 初音ミク' },
  { id: 'BeK9FCVhXsU', title: '"インパルシヴ・リブート" ／ 初音ミク' },
  { id: 'WVx9O6o713o', title: '"クレイドル" ／ 初音ミク' },
  { id: 'z1Emzece7go', title: '"あの頃の僕が生きたのはこんな偽物の夏じゃなかった。" ／ 初音ミク' },
  { id: '5N4cEBZXqGE', title: '"Sync." ／ 初音ミク' },
  { id: 'f0N4c63ES38', title: '"Daydream" ／ 初音ミク' },
  { id: 'eNexsdA2GEw', title: '"ワールドリー・シアター" ／ 初音ミク' },
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
