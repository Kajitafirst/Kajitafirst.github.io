import Hero from './components/Hero'
import VideoGallery from './components/VideoGallery'
import SocialLinks from './components/SocialLinks'
import StarBackground from './components/StarBackground'
import './App.css'

function App() {
  return (
    <div className="app-container">
      <StarBackground />
      <main>
        <Hero />
        <VideoGallery />
        <SocialLinks />
      </main>
    </div>
  )
}

export default App
