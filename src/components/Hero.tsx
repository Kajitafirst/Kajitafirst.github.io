import React from 'react';
import artistImage from '../assets/hero.png';

const Hero: React.FC = () => {
  return (
    <section className="hero">
      <div className="artist-image-container">
        <img src={artistImage} alt="星ノ座 Artist" className="artist-image" />
      </div>
      <div className="glass-card">
        <h1>星ノ座</h1>
        <p className="subtitle">Hoshinoza - Vocaloid Producer</p>
        <div className="concept">
          <p>
            星ノ座は、初音ミクをはじめとする合成音声と共に、ジャンルの垣根を超えた多種多様な世界観を構築する音楽プロジェクトです。
            ギリシャ神話が夜空に物語を刻んだように、音楽制作を通じて宇宙の断片を紡ぎます。
            楽曲ごとに表情を変える万華鏡のような作品を、その耳で体感してください。
          </p>
        </div>
      </div>
    </section>
  );
};

export default Hero;
