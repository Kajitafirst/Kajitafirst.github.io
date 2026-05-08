import React, { useEffect, useState } from 'react';
import './StarBackground.css';

interface Star {
  id: number;
  top: string;
  left: string;
  size: string;
  duration: string;
}

interface ShootingStar {
  id: number;
  top: string;
  left: string;
  duration: string;
  delay: string;
}

const StarBackground: React.FC = () => {
  const [stars, setStars] = useState<Star[]>([]);
  const [shootingStars, setShootingStars] = useState<ShootingStar[]>([]);

  useEffect(() => {
    const starCount = 150;
    const newStars = Array.from({ length: starCount }).map((_, i) => ({
      id: i,
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      size: `${Math.random() * 2 + 1}px`,
      duration: `${2 + Math.random() * 5}s`,
    }));
    setStars(newStars);

    const shootingStarCount = 6;
    const newShootingStars = Array.from({ length: shootingStarCount }).map((_, i) => ({
      id: i,
      top: `${Math.random() * 50}%`,
      left: `${50 + Math.random() * 50}%`,
      duration: `${3 + Math.random() * 4}s`,
      delay: `${Math.random() * 10}s`,
    }));
    setShootingStars(newShootingStars);
  }, []);

  return (
    <div className="stars-container">
      <div className="constellation"></div>
      {stars.map((star) => (
        <div
          key={`star-${star.id}`}
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
      {shootingStars.map((sStar) => (
        <div
          key={`shooting-${sStar.id}`}
          className="shooting-star"
          style={{
            '--top': sStar.top,
            '--left': sStar.left,
            '--duration': sStar.duration,
            '--delay': sStar.delay,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
};

export default StarBackground;
