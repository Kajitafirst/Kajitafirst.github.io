import React from 'react';

const Hero: React.FC = () => {
  return (
    <section className="hero">
      <div className="glass-card">
        <h1>星ノ座</h1>
        <p className="subtitle">Hoshinoza - Vocaloid Artist</p>
        <div className="concept">
          <p>
            「星座が様々なギリシャ神話に基づいて作られているように、様々なジャンル、様々な物語・世界観を歌にする」
          </p>
          <p>
            星ノ座は、初音ミクと共に、宇宙に散らばる無数の物語を音楽として紡いでいます。
            一曲一曲が夜空を彩る星座のように、それぞれ異なる世界観と感情を宿しています。
          </p>
        </div>
      </div>
    </section>
  );
};

export default Hero;
