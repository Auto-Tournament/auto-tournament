import { InMemoryDatabase } from 'brackets-memory-db';
import { BracketsManager } from 'brackets-manager';
import { BracketsViewer } from './main';
import type { ParticipantImage } from './types';
import type { Locale } from './lang';
import './form';

const viewer = new BracketsViewer();
const inMemoryDatabase = new InMemoryDatabase();
const bracketsManager = new BracketsManager(inMemoryDatabase);

if (typeof window !== 'undefined') {
  window.bracketsViewer = viewer;
  window.inMemoryDatabase = inMemoryDatabase;
  window.bracketsManager = bracketsManager;
}

export function render(...args: Parameters<BracketsViewer['render']>) {
  return viewer.render(...args);
}

export function setParticipantImages(images: ParticipantImage[]) {
  viewer.setParticipantImages(images);
}

export function addLocale(name: string, locale: Locale) {
  return viewer.addLocale(name, locale);
}

export function getViewer() {
  return viewer;
}

export { BracketsViewer };
export type { ParticipantImage, Locale };
export * from './types';
