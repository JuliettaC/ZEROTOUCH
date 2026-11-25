import React from 'react'
import { Composition } from 'remotion'
import { Promo } from './Promo'
import { DURACION_S, FPS } from './tiempos.js'

export const Raiz: React.FC = () => (
  <Composition id="Promo" component={Promo} durationInFrames={DURACION_S * FPS} fps={FPS} width={1920} height={1080} />
)
