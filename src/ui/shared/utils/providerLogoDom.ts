import type { ChatIconSvg, ChatUIOption } from '@pivi/core';
import { setIcon } from 'obsidian';

import { createChatIconSvg } from './icons';


const LOCAL_PROVIDER_LOGO_DATA_URI: Record<string, string> = {
  anthropic: 'data:image/svg+xml,%3Csvg%20fill=%22currentColor%22%20fill-rule=%22evenodd%22%20height=%221em%22%20style=%22flex:none;line-height:1%22%20viewBox=%220%200%2024%2024%22%20width=%221em%22%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ctitle%3EAnthropic%3C/title%3E%3Cpath%20d=%22M13.827%203.52h3.603L24%2020h-3.603l-6.57-16.48zm-7.258%200h3.767L16.906%2020h-3.674l-1.343-3.461H5.017l-1.344%203.46H0L6.57%203.522zm4.132%209.959L8.453%207.687%206.205%2013.48H10.7z%22%3E%3C/path%3E%3C/svg%3E',
  deepseek: 'data:image/svg+xml,%3Csvg%20fill=%22currentColor%22%20fill-rule=%22evenodd%22%20height=%221em%22%20style=%22flex:none;line-height:1%22%20viewBox=%220%200%2024%2024%22%20width=%221em%22%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ctitle%3EDeepSeek%3C/title%3E%3Cpath%20d=%22M23.748%204.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434%201.202-.422%201.84.027%201.436.633%202.58%201.838%203.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526%205.526%200%2001-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365%2011.365%200%2000-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055%203.055%200%2001-.465.137%209.597%209.597%200%2000-2.883-.102c-1.885.21-3.39%201.102-4.497%202.623C.082%208.606-.231%2010.684.152%2012.85c.403%202.284%201.569%204.175%203.36%205.653%201.858%201.533%203.997%202.284%206.438%202.14%201.482-.085%203.133-.284%204.994-1.86.47.234.962.327%201.78.397.63.059%201.236-.03%201.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926%201.096-1.296%202.746-2.642%203.392-7.003.05-.347.007-.565%200-.845-.004-.17.035-.237.23-.256a4.173%204.173%200%20001.545-.475c1.396-.763%201.96-2.015%202.093-3.517.02-.23-.004-.467-.247-.588zM11.581%2018c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696%204.696%200%20011.529-.039c2.132.312%203.946%201.265%205.468%202.774.868.86%201.525%201.887%202.202%202.891.72%201.066%201.494%202.082%202.48%202.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306%200%2001.415-.287.302.302%200%2001.2.288.306.306%200%2001-.31.307.303.303%200%2001-.304-.308zm3.11%201.596c-.2.081-.399.151-.59.16a1.245%201.245%200%2001-.798-.254c-.274-.23-.47-.358-.552-.758a1.73%201.73%200%2001.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559%200%2001-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136%201.146.016.352.144.618.408%201.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z%22%3E%3C/path%3E%3C/svg%3E',
  google: 'data:image/svg+xml,%3Csvg%20fill=%22currentColor%22%20fill-rule=%22evenodd%22%20height=%221em%22%20style=%22flex:none;line-height:1%22%20viewBox=%220%200%2024%2024%22%20width=%221em%22%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ctitle%3EGoogle%3C/title%3E%3Cpath%20d=%22M23%2012.245c0-.905-.075-1.565-.236-2.25h-10.54v4.083h6.186c-.124%201.014-.797%202.542-2.294%203.569l-.021.136%203.332%202.53.23.022C21.779%2018.417%2023%2015.593%2023%2012.245z%22%3E%3C/path%3E%3Cpath%20d=%22M12.225%2023c3.03%200%205.574-.978%207.433-2.665l-3.542-2.688c-.948.648-2.22%201.1-3.891%201.1a6.745%206.745%200%2001-6.386-4.572l-.132.011-3.465%202.628-.045.124C4.043%2020.531%207.835%2023%2012.225%2023z%22%3E%3C/path%3E%3Cpath%20d=%22M5.84%2014.175A6.65%206.65%200%20015.463%2012c0-.758.138-1.491.361-2.175l-.006-.147-3.508-2.67-.115.054A10.831%2010.831%200%20001%2012c0%201.772.436%203.447%201.197%204.938l3.642-2.763z%22%3E%3C/path%3E%3Cpath%20d=%22M12.225%205.253c2.108%200%203.529.892%204.34%201.638l3.167-3.031C17.787%202.088%2015.255%201%2012.225%201%207.834%201%204.043%203.469%202.197%207.062l3.63%202.763a6.77%206.77%200%20016.398-4.572z%22%3E%3C/path%3E%3C/svg%3E',
  openai: 'data:image/svg+xml,%3Csvg%20fill=%22currentColor%22%20fill-rule=%22evenodd%22%20height=%221em%22%20style=%22flex:none;line-height:1%22%20viewBox=%220%200%2024%2024%22%20width=%221em%22%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ctitle%3EOpenAI%3C/title%3E%3Cpath%20d=%22M9.205%208.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357%201.356-.523%202.117-.523%202.854%200%204.662%202.212%204.662%204.566%200%20.167%200%20.357-.024.547l-4.71-2.759a.797.797%200%2000-.856%200l-5.97%203.473zm10.609%208.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473%201.95-1.118a.433.433%200%2001.476%200l4.543%202.617c1.309.76%202.189%202.378%202.189%203.948%200%201.808-1.07%203.473-2.76%204.163zM7.802%2012.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545%201.95-4.472%204.591-4.472%201%200%201.927.333%202.712.928L8.23%205.067c-.285.166-.428.404-.428.737v6.898zM12%2015.128l-2.795-1.57v-3.33L12%208.658l2.795%201.57v3.33L12%2015.128zm1.796%207.23c-1%200-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974%201.142c.167.095.238.238.238.428v5.233c0%202.545-1.974%204.472-4.614%204.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482%204.482%200%20014.21%206.327v5.423c0%20.333.143.571.428.738l5.947%203.449-1.95%201.118a.432.432%200%2001-.476%200zm-.262%203.9c-2.688%200-4.662-2.021-4.662-4.519%200-.19.024-.38.047-.57l4.686%202.71c.286.167.571.167.856%200l5.97-3.448v2.26c0%20.19-.07.333-.237.428l-4.543%202.616c-.619.357-1.356.523-2.117.523zm5.899%202.83a5.947%205.947%200%20005.827-4.756C22.287%2018.339%2024%2015.84%2024%2013.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498%200-3.401-2.759-5.947-5.946-5.947-.642%200-1.26.095-1.88.31A5.962%205.962%200%200010.205%200a5.947%205.947%200%2000-5.827%204.757C1.713%205.447%200%207.945%200%2010.49c0%201.666.713%203.283%201.998%204.448-.119.5-.19%201-.19%201.499%200%203.401%202.759%205.946%205.946%205.946.642%200%201.26-.095%201.88-.309a5.96%205.96%200%20004.162%201.713z%22%3E%3C/path%3E%3C/svg%3E',
  opencode: 'data:image/svg+xml,%3Csvg%20fill=%22currentColor%22%20fill-rule=%22evenodd%22%20height=%221em%22%20style=%22flex:none;line-height:1%22%20viewBox=%220%200%2024%2024%22%20width=%221em%22%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ctitle%3Eopencode%3C/title%3E%3Cpath%20d=%22M16%206H8v12h8V6zm4%2016H4V2h16v20z%22%3E%3C/path%3E%3C/svg%3E',
  openrouter: 'data:image/svg+xml,%3Csvg%20fill=%22currentColor%22%20fill-rule=%22evenodd%22%20height=%221em%22%20style=%22flex:none;line-height:1%22%20viewBox=%220%200%2024%2024%22%20width=%221em%22%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ctitle%3EOpenRouter%3C/title%3E%3Cpath%20d=%22M16.804%201.957l7.22%204.105v.087L16.73%2010.21l.017-2.117-.821-.03c-1.059-.028-1.611.002-2.268.11-1.064.175-2.038.577-3.147%201.352L8.345%2011.03c-.284.195-.495.336-.68.455l-.515.322-.397.234.385.23.53.338c.476.314%201.17.796%202.701%201.866%201.11.775%202.083%201.177%203.147%201.352l.3.045c.694.091%201.375.094%202.825.033l.022-2.159%207.22%204.105v.087L16.589%2022l.014-1.862-.635.022c-1.386.042-2.137.002-3.138-.162-1.694-.28-3.26-.926-4.881-2.059l-2.158-1.5a21.997%2021.997%200%2000-.755-.498l-.467-.28a55.927%2055.927%200%2000-.76-.43C2.908%2014.73.563%2014.116%200%2014.116V9.888l.14.004c.564-.007%202.91-.622%203.809-1.124l1.016-.58.438-.274c.428-.28%201.072-.726%202.686-1.853%201.621-1.133%203.186-1.78%204.881-2.059%201.152-.19%201.974-.213%203.814-.138l.02-1.907z%22%3E%3C/path%3E%3C/svg%3E',
};

function getProviderLogoFallbackIcon(slug: string): string {
  if (slug.includes('github') || slug.includes('opencode')) return 'github';
  if (slug.includes('google')) return 'sparkles';
  if (slug.includes('bedrock') || slug.includes('amazon')) return 'cloud';
  if (slug.includes('azure') || slug.includes('cloudflare')) return 'cloud-cog';
  if (slug.includes('openai') || slug.includes('anthropic')) return 'bot';
  return 'cpu';
}

export interface AppendProviderLogoOptions {
  size?: number;
  className?: string;
}

/**
 * Appends a bundled provider logo mask, falling back to a local Lucide icon.
 *
 * Obsidian community review prefers bundled/local UI assets over runtime CDN
 * fetches, so provider logos intentionally do not load remote SVGs.
 */
export function appendProviderLogo(
  parent: HTMLElement,
  slug: string,
  options: AppendProviderLogoOptions = {},
): HTMLElement {
  const size = options.size ?? 14;
  const dataUri = LOCAL_PROVIDER_LOGO_DATA_URI[slug];
  const classes = [dataUri ? 'pivi-provider-logo-mask' : 'pivi-provider-logo-lucide'];
  if (options.className) {
    classes.push(options.className);
  }
  const el = parent.createSpan({
    cls: classes.join(' '),
    attr: { 'aria-hidden': 'true' },
  });
  if (size !== 14) {
    el.style.setProperty('--pivi-provider-logo-size', `${size}px`);
  }
  if (dataUri) {
    el.style.setProperty('-webkit-mask-image', `url("${dataUri}")`);
    el.style.setProperty('mask-image', `url("${dataUri}")`);
  } else {
    setIcon(el, getProviderLogoFallbackIcon(slug));
  }
  return el;
}

export interface AppendModelOptionIconOptions {
  size?: number;
  className?: string;
  fallbackChatIcon?: ChatIconSvg;
}

type ModelIconFields = Pick<ChatUIOption, 'providerLogoSlug' | 'chatIcon' | 'fallbackIcon'>;

/**
 * Renders provider brand logo, inline chat icon, or Lucide fallback for a model option.
 */
export function appendModelOptionIcon(
  parent: HTMLElement,
  option: ModelIconFields,
  iconOptions: AppendModelOptionIconOptions = {},
): HTMLElement | SVGElement | null {
  const size = iconOptions.size ?? 12;
  const className = iconOptions.className ?? 'pivi-model-provider-icon';

  if (option.providerLogoSlug) {
    return appendProviderLogo(parent, option.providerLogoSlug, { size, className });
  }

  const chatIcon = option.chatIcon ?? iconOptions.fallbackChatIcon;
  if (chatIcon) {
    const svg = createChatIconSvg(chatIcon, {
      className,
      height: size,
      ownerDocument: parent.ownerDocument,
      width: size,
    });
    parent.appendChild(svg);
    return svg;
  }

  const lucide = option.fallbackIcon ?? 'cpu';
  const iconHost = parent.createSpan({ cls: className });
  setIcon(iconHost, lucide);
  return iconHost;
}
