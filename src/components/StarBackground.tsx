import React, { useEffect, useState } from 'react';

const StarBackground: React.FC = () => {
  const [stars, setStars] = useState<{ id: number; top: string; left: string; size: string; duration: string }[]>([]);

  useEffect(() => {
    const starCount = 150;
    const newStars = Array.from({ length: starCount }).map((_, i) => ({
      id: i,
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      size: `${Math.random() * 3}px`,
      duration: `${2 + Math.random() * 5}s`,
    }));
    setStars(newStars);
  }, []);

  return (
    <div className="stars-container">
      <div className="constellation"></div>
      {stars.map((star) => (
        <div
          key={star.id}
          className="star"
          style={{
            top: star.top,
            left: star.left,
            width: star.size,
            height: star.size,
            '--duration': star.duration,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
};

export default StarBackground;
