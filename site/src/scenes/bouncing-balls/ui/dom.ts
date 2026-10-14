/** A minimal element builder, so the panel can be written as a tree instead of strings of HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
	...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
	const { class: className, ...rest } = props;
	const node = Object.assign(document.createElement(tag), rest);
	if (className) node.className = className;
	node.append(...children);
	return node;
}

/** A labelled number input. `onChange` receives only valid numbers. */
export function numberField(
	label: string,
	options: { min?: number; max?: number; step?: number; value: number },
	onChange: (value: number) => void,
): { root: HTMLLabelElement; input: HTMLInputElement } {
	const input = el('input', { type: 'number', ...stringify(options) });
	input.addEventListener('input', () => {
		const value = input.valueAsNumber;
		if (Number.isFinite(value)) onChange(value);
	});
	return { root: el('label', { class: 'bb-field' }, el('span', {}, label), input), input };
}

/** A labelled slider that shows its current value. */
export function sliderField(
	label: string,
	options: { min: number; max: number; step: number; value: number },
	onChange: (value: number) => void,
): { root: HTMLLabelElement; input: HTMLInputElement; set(value: number): void } {
	const input = el('input', { type: 'range', ...stringify(options) });
	const output = el('output', {}, String(options.value));
	input.addEventListener('input', () => {
		output.textContent = input.value;
		onChange(input.valueAsNumber);
	});
	return {
		root: el('label', { class: 'bb-field bb-slider' }, el('span', {}, label), input, output),
		input,
		set(value) {
			// Do not fight the user while they drag this slider. The text shows the real value even beyond the slider's range.
			if (document.activeElement !== input) input.value = String(value);
			output.textContent = String(+value.toFixed(2));
		},
	};
}

export function checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void): { root: HTMLLabelElement; input: HTMLInputElement } {
	const input = el('input', { type: 'checkbox', checked });
	input.addEventListener('change', () => onChange(input.checked));
	return { root: el('label', { class: 'bb-check' }, input, el('span', {}, label)), input };
}

export function select<T extends string>(
	label: string,
	choices: { value: T; label: string }[],
	value: T,
	onChange: (value: T) => void,
): { root: HTMLLabelElement; input: HTMLSelectElement } {
	const input = el('select', {}, ...choices.map((c) => el('option', { value: c.value, textContent: c.label })));
	input.value = value;
	input.addEventListener('change', () => onChange(input.value as T));
	return { root: el('label', { class: 'bb-field' }, el('span', {}, label), input), input };
}

export function button(label: string, onClick: () => void): HTMLButtonElement {
	const b = el('button', { type: 'button', textContent: label });
	b.addEventListener('click', onClick);
	return b;
}

/** Input attributes are strings in the DOM; convert the numeric options once. */
function stringify(options: Record<string, number>): Record<string, string> {
	return Object.fromEntries(Object.entries(options).map(([k, v]) => [k, String(v)]));
}
