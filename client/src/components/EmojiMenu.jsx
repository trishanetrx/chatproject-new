import React from 'react';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';

export default function EmojiMenu({ onSelect }) {
  return <Picker data={data} onEmojiSelect={emoji => onSelect(emoji.native)} theme="light" set="native" dynamicWidth autoFocus={window.matchMedia('(pointer: fine)').matches} previewPosition="none" skinTonePosition="search" emojiButtonRadius="8px" maxFrequentRows={2} />;
}
