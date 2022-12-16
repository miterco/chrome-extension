import bridge from './bridge';
import env from './derived/env';
import {v4 as _uuid} from 'uuid';

//Generic DOM Stuff

export const createChildObserver = (element: Element, handler: MutationCallback, observeSubtree: boolean = false) => {
  let observer = new MutationObserver(handler);
  observer.observe(element, {attributes: false, childList: true, subtree: observeSubtree ? true : false});
  return observer;
}

export const getAncestor = (el: HTMLElement | null, level: number) => {
  if (!el) return null;
  if (!level) return el;
  return getAncestor(el.parentElement, level - 1);
}

export const log = (msg: any) => {
  if (env.DEBUG) console.log(msg);
}

export const error = (msg: any) => {
  console.error(msg);
}

export const domWarning = (msg: string) => {
  if (env.DEBUG) {
    log(`Miter DOM Warning: ${msg}`);
  } else {
    bridge.track("DOM Warning", {details: msg});
  }
}

export const uuid = () => {
  return _uuid();
}

export const isElementInDom = (el) => {
  if (!el) return false;
  if (el === document.body) return true;
  return isElementInDom(el.parentElement);
}