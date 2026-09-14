// @ts-check
// One grouped import next to an ungrouped one, with no `sprites` option: the grouped atom
// gets its own sprite, the ungrouped atom keeps its own subset asset.
import { BackpackFilled } from '@fluentui/react-icons/svg-sprite/backpack?sprite=critical';
import { CalculatorFilled } from '@fluentui/react-icons/svg-sprite/calculator';

console.log('mixed grouped / ungrouped svg-sprites loaded');
console.dir({ BackpackFilled, CalculatorFilled });
