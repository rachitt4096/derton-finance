let audioContext = null

const getAudioContext = () => {
  if (typeof window === 'undefined') {
    return null
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) {
    return null
  }

  if (!audioContext) {
    audioContext = new AudioContextClass()
  }

  return audioContext
}

const scheduleTone = (context, { frequency, startTime, duration, gain }) => {
  const oscillator = context.createOscillator()
  const gainNode = context.createGain()

  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(frequency, startTime)

  gainNode.gain.setValueAtTime(0.0001, startTime)
  gainNode.gain.exponentialRampToValueAtTime(gain, startTime + 0.01)
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

  oscillator.connect(gainNode)
  gainNode.connect(context.destination)

  oscillator.start(startTime)
  oscillator.stop(startTime + duration + 0.02)
}

export const primeAlertAudio = async () => {
  const context = getAudioContext()
  if (!context) {
    return false
  }

  if (context.state === 'suspended') {
    try {
      await context.resume()
    } catch {
      return false
    }
  }

  return context.state === 'running'
}

export const playAlertTone = async (tone = 'high') => {
  const context = getAudioContext()
  if (!context) {
    return false
  }

  const play = () => {
    const startTime = context.currentTime + 0.01

    if (tone === 'low') {
      scheduleTone(context, { frequency: 392, startTime, duration: 0.12, gain: 0.035 })
      scheduleTone(context, { frequency: 330, startTime: startTime + 0.14, duration: 0.18, gain: 0.03 })
      return true
    }

    scheduleTone(context, { frequency: 880, startTime, duration: 0.1, gain: 0.03 })
    scheduleTone(context, { frequency: 1174, startTime: startTime + 0.12, duration: 0.14, gain: 0.025 })
    return true
  }

  if (context.state === 'suspended') {
    try {
      await context.resume()
    } catch {
      return false
    }
  }

  if (context.state !== 'running') {
    return false
  }

  return play()
}
