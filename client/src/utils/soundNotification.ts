/**
 * Sound notification utility for team match alerts
 * Supports multiple notification sounds from public/alerts folder
 * 
 * Sound Effects by DRAGON-STUDIO from Pixabay
 * https://pixabay.com/sound-effects/
 */

// Available notification sounds (from public/alerts/)
export const NOTIFICATION_SOUNDS = [
  { value: 'notification', label: 'Classic Notification' },
  { value: 'notification-bell-sound-1-376885', label: 'Bell' },
  { value: 'notification-sound-effect-372475', label: 'Alert Tone' },
  { value: 'pop-402324', label: 'Pop' },
  { value: 'whoosh-cinematic-376875', label: 'Whoosh' },
  { value: 'thud-sound-effect-405470', label: 'Thud' },
  { value: 'drum-beat-02-36276', label: 'Drum Beat' },
  { value: 'slow-cinematic-clock-ticking-405471', label: 'Clock Ticking' },
] as const;

export type NotificationSoundValue = typeof NOTIFICATION_SOUNDS[number]['value'];

class SoundNotification {
  private audio: HTMLAudioElement | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.25;
  private soundFile: NotificationSoundValue = 'notification';

  constructor() {
    // Check localStorage for preferences
    const savedMute = localStorage.getItem('teamMatchSoundMuted');
    const savedVolume = localStorage.getItem('teamMatchSoundVolume');
    const savedSound = localStorage.getItem('teamMatchSoundFile') as NotificationSoundValue | null;
    
    this.isMuted = savedMute === 'true';
    this.volume = savedVolume ? parseFloat(savedVolume) : 0.25;
    this.soundFile = savedSound || 'drum-beat-02-36276';

    // Initialize audio element
    this.initAudio();
  }

  /**
   * Initialize audio element
   */
  private initAudio() {
    this.audio = new Audio(`/alerts/${this.soundFile}.mp3`);
    this.audio.volume = this.volume;
  }

  /**
   * Reload audio with new sound file
   */
  private reloadAudio() {
    this.audio = new Audio(`/alerts/${this.soundFile}.mp3`);
    this.audio.volume = this.volume;
  }

  /**
   * Play notification sound
   */
  playNotification() {
    if (this.isMuted || !this.audio) return;

    try {
      // Reset to beginning if already playing
      this.audio.currentTime = 0;
      this.audio.volume = this.volume;
      
      // Play the sound
      const playPromise = this.audio.play();
      
      // Handle autoplay policy
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.warn('Could not play notification sound:', error);
        });
      }
    } catch (error) {
      console.error('Error playing notification sound:', error);
    }
  }

  /**
   * Preview sound (for testing)
   */
  previewSound() {
    if (!this.audio) return;

    try {
      this.audio.currentTime = 0;
      this.audio.volume = this.volume;
      
      const playPromise = this.audio.play();
      
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.warn('Could not preview sound:', error);
        });
      }
    } catch (error) {
      console.error('Error previewing sound:', error);
    }
  }

  /**
   * Stop currently playing sound
   */
  stopSound() {
    if (!this.audio) return;

    try {
      this.audio.pause();
      this.audio.currentTime = 0;
    } catch (error) {
      console.error('Error stopping sound:', error);
    }
  }

  /**
   * Toggle mute state
   */
  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    localStorage.setItem('teamMatchSoundMuted', String(this.isMuted));
    return this.isMuted;
  }

  /**
   * Get current mute state
   */
  isMutedState(): boolean {
    return this.isMuted;
  }

  /**
   * Set mute state
   */
  setMute(muted: boolean) {
    this.isMuted = muted;
    localStorage.setItem('teamMatchSoundMuted', String(muted));
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    localStorage.setItem('teamMatchSoundVolume', String(this.volume));
    
    if (this.audio) {
      this.audio.volume = this.volume;
    }
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.volume;
  }

  /**
   * Set sound file
   */
  setSoundFile(soundFile: NotificationSoundValue) {
    this.stopSound(); // Stop any currently playing sound
    this.soundFile = soundFile;
    localStorage.setItem('teamMatchSoundFile', soundFile);
    this.reloadAudio();
  }

  /**
   * Get current sound file
   */
  getSoundFile(): NotificationSoundValue {
    return this.soundFile;
  }
}

export const soundNotification = new SoundNotification();

