export type InteractiveElementType =
  | 'link'
  | 'button'
  | 'input'
  | 'select'
  | 'form'
  | 'tab'
  | 'menu-item';

export interface InteractiveElement {
  type: InteractiveElementType;
  selector: string;
  text?: string;
  href?: string;
  ariaLabel?: string;
}

export interface DiscoveredPage {
  id: string;
  url: string;
  title: string;
  depth: number;
  visitOrder: number;
  parentPageId?: string;
  outboundLinks: string[];
  interactiveElements: InteractiveElement[];
  hasForm: boolean;
  httpStatus: number;
  redirectedFrom?: string;
}
