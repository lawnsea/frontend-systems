import anyTest, { TestFn } from 'ava';
import { Env } from '../helpers/env.js';
import { EventSubscriptionProcessor } from '../../../main-thread/commands/event-subscription.js';
import { CommandExecutor } from '../../../main-thread/commands/interface.js';
import { NodeContext, BASE_ELEMENT_INDEX } from '../../../main-thread/nodes.js';
import { StringContext } from '../../../main-thread/strings.js';
import { WorkerContext } from '../../../main-thread/worker.js';
import { normalizeConfiguration } from '../../../main-thread/configuration.js';
import { TransferrableMutationType } from '../../../transfer/TransferrableMutation.js';
import { EventToWorker, MessageToWorker, MessageType } from '../../../transfer/Messages.js';
import { TransferrableKeys } from '../../../transfer/TransferrableKeys.js';

const test = anyTest as TestFn<{
  env: Env;
  baseElement: HTMLElement;
  button: HTMLElement;
  processor: CommandExecutor;
  forwardedIndexes: () => number[];
}>;

const CLICK = 0;

test.beforeEach((t) => {
  const env = new Env();
  const baseElement = env.document.createElement('div');
  const button = env.document.createElement('span');
  baseElement.appendChild(button);
  env.document.body.appendChild(baseElement);

  const strings = new StringContext();
  strings.storeValues(['click']);
  const nodeContext = new NodeContext(strings, baseElement);
  const messages: MessageToWorker[] = [];
  const workerContext = { messageToWorker: (m: MessageToWorker) => messages.push(m) } as unknown as WorkerContext;
  const processor = EventSubscriptionProcessor(
    strings,
    nodeContext,
    workerContext,
    undefined as any,
    normalizeConfiguration({ authorURL: '', domURL: '' }),
  );
  const forwardedIndexes = () =>
    messages
      .filter((m) => m[TransferrableKeys.type] === MessageType.EVENT)
      .map((m) => (m as EventToWorker)[TransferrableKeys.event][TransferrableKeys.index]);

  t.context = { env, baseElement, button, processor, forwardedIndexes };
});

test.afterEach((t) => {
  t.context.env.dispose();
});

function subscribe(processor: CommandExecutor, target: number, id: number) {
  processor.execute(new Uint16Array([TransferrableMutationType.EVENT_SUBSCRIPTION, target, 0, 1, CLICK, id, 0, 0, 0, 0]), 0, true);
}

function unsubscribe(processor: CommandExecutor, target: number, id: number) {
  processor.execute(new Uint16Array([TransferrableMutationType.EVENT_SUBSCRIPTION, target, 1, 0, CLICK, id]), 0, true);
}

function click(t: { context: { env: Env } }, element: Element) {
  element.dispatchEvent(new (t.context.env.window as any).MouseEvent('click', { bubbles: true }));
}

test.serial('forwards an event once when several listeners on its path fire', (t) => {
  const { processor, button, forwardedIndexes } = t.context;
  const buttonIndex = (button as any)._index_;
  subscribe(processor, buttonIndex, 0);
  subscribe(processor, BASE_ELEMENT_INDEX, 0);

  click(t, button);

  t.deepEqual(forwardedIndexes(), [buttonIndex]);
});

test.serial('listens on the base element, not the rest of the page', (t) => {
  const { env, processor, baseElement, forwardedIndexes } = t.context;
  subscribe(processor, BASE_ELEMENT_INDEX, 0);

  click(t, env.document.body);
  t.deepEqual(forwardedIndexes(), []);

  click(t, baseElement);
  t.deepEqual(forwardedIndexes(), [BASE_ELEMENT_INDEX]);
});

test.serial('removes the listener a node added when another node uses the same id', (t) => {
  const { processor, button, forwardedIndexes } = t.context;
  const buttonIndex = (button as any)._index_;
  subscribe(processor, buttonIndex, 0);
  subscribe(processor, BASE_ELEMENT_INDEX, 0);

  unsubscribe(processor, buttonIndex, 0);
  click(t, button);

  t.deepEqual(forwardedIndexes(), [BASE_ELEMENT_INDEX]);
});
