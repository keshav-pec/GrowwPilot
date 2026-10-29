import { describe, expect, it } from 'vitest';
import { answerQuestion, toTokens } from '../src/modules/help/help.matcher.js';
import { KNOWLEDGE } from '../src/modules/help/help.knowledge.js';

const owner = { audience: 'PRIMARY_OWNER', name: 'Anita', branch: 'Andheri', salon: 'Glamour Studio' };
const branchOwner = { audience: 'BRANCH_OWNER', name: 'Vikram', branch: 'Bandra', salon: 'Glamour Studio' };
const desk = { audience: 'FRONT_DESK', name: 'Kavya', branch: 'Andheri', salon: 'Glamour Studio' };

describe('Understanding the question', () => {
  it('cleans the text: lower case, no punctuation, no filler words, plurals and synonyms', () => {
    expect(toTokens("How do I add 2 new Stylists?")).toEqual(['add', '2', 'new', 'staff']);
    expect(toTokens("Can't log in")).toEqual(['cant', 'log']);
    expect(toTokens('Cancel an appointment')).toEqual(['cancel', 'booking']);
  });

  // [question someone might type, topic we expect]
  const questions = [
    ['How do I book an appointment?', 'book'],
    ['new booking', 'book'],
    ['how do i cancel a booking', 'cancel'],
    ['I want to reschedule Priya to 5 pm', 'reschedule'],
    ['it says slot already booked by another desk', 'slot-taken'],
    ['what do the colours on the day board mean', 'day-board'],
    ['customer came without appointment', 'walk-in'],
    ['how to book a combo', 'combo-booking'],
    ['two services with different stylists', 'multi-service'],
    ['add a new client', 'customer-add'],
    ['where can I see customer history and total spend', 'customer-profile'],
    ['how do I convert a lead', 'lead-convert'],
    ['add an instagram enquiry', 'lead-add'],
    ['customer wants to pay by card and cash', 'checkout'],
    ['how do I give 10% discount', 'discount'],
    ['print the invoice again', 'invoice'],
    ['mark a barber absent today', 'attendance'],
    ['my stylist is sick, who takes her booking?', 'reassign'],
    ['I forgot my password', 'password'],
    ['what is salon pulse', 'dashboard'],
    ['how do I download the sales pdf report', 'analytics'],
    ['how do I add a new service and change price', 'services'],
    ['create a combo', 'combos'],
    ['change opening hours', 'branches'],
    ['how do I give a raise to Rahul', 'salary'],
    ['how is commission calculated', 'commission'],
    ['set a special rate for hair colour', 'commission'],
    ['how do I lock the month', 'monthly-payroll'],
    ['pay salary to Neha', 'salary-payments'],
    ['download payslip', 'salary-payments'],
    ['how do I pay the front desk salary', 'front-desk-pay'],
    ['approve a pay request', 'pay-requests'],
    ['who changed the commission rate in the activity log', 'activity-log'],
    ['how do I set up birthday offers', 'occasions-setup'],
    ['switch on the occasion offers', 'occasions-setup'],
    ['where do I add a customer birthday month', 'occasions-dates'],
    ['import birthdays from excel', 'occasions-dates'],
    ['how do I record whatsapp permission', 'occasions-permission'],
    ['customer wants to opt out of messages', 'occasions-permission'],
    ['who to contact for birthdays this month', 'occasions-list'],
    ['send birthday offer on whatsapp', 'occasions-list'],
    ['how do I apply the birthday offer at checkout', 'occasions-checkout'],
    ['anniversary discount', 'occasions-checkout'],
    ['why can’t I apply the offer', 'occasions-cant-apply'],
    ['offer redeemed elsewhere message', 'occasions-cant-apply'],
    ['birthday report with associated sales', 'occasions-reports'],
    ['hello', 'greeting'],
    ['thanks!', 'thanks'],
  ];
  it.each(questions)('"%s" -> %s', (question, topicId) => {
    expect(answerQuestion(question, owner).topicId).toBe(topicId);
  });
});

describe('Answers are limited to the person asking', () => {
  it('gives an owner the steps for owner topics', () => {
    const reply = answerQuestion('how do I add a stylist', owner);
    expect(reply).toMatchObject({ kind: 'answer', topicId: 'staff', link: { to: '/app/team' } });
  });

  it("tells the front desk who can do it, instead of the steps (and no link to a page they can't open)", () => {
    const reply = answerQuestion('how do I add a stylist', desk);
    expect(reply.kind).toBe('not-allowed');
    expect(reply.answer).toContain('Only owners can add or remove stylists');
    expect(reply.link).toBeNull();
  });

  it('keeps revenue and analytics away from the front desk', () => {
    expect(answerQuestion('show me the dashboard', desk).kind).toBe('not-allowed');
    expect(answerQuestion('export sales pdf', desk).kind).toBe('not-allowed');
  });

  it("separates the main owner from a branch owner (only the main owner changes services)", () => {
    expect(answerQuestion('add a new service', owner).kind).toBe('answer');
    const reply = answerQuestion('add a new service', branchOwner);
    expect(reply.kind).toBe('not-allowed');
    expect(reply.answer).toBe('Only the main owner of Glamour Studio can change services and prices.');
  });

  it('gives the same topic different words for different roles, filled in with their details', () => {
    expect(answerQuestion('forgot password', desk).answer).toContain('ask your salon owner');
    expect(answerQuestion('forgot password', owner).answer).toContain('Reset password');
    expect(answerQuestion('switch branch', desk).answer).toContain('**Andheri** only');
    expect(answerQuestion('hi', desk).answer).toContain('Hi Kavya!');
  });
});

describe('When it does not understand', () => {
  it('says so and suggests questions for that role', () => {
    const reply = answerQuestion('what is the weather in Mumbai', desk);
    expect(reply.kind).toBe('fallback');
    expect(reply.suggestions).toContain('How do I book an appointment?');
  });

  it('occasion offer topics: owners set them up, the front desk is told who does', () => {
    expect(answerQuestion('how do I set up birthday offers', owner).kind).toBe('answer');
    const deskReply = answerQuestion('how do I set up birthday offers', desk);
    expect(deskReply).toMatchObject({ topicId: 'occasions-setup', kind: 'not-allowed', link: null });
    expect(deskReply.answer).toMatch(/owners/);
    expect(answerQuestion('show me the birthday report', desk).answer).toMatch(/Today page/);
    expect(answerQuestion('how do I record whatsapp permission', desk).answer).toMatch(/Customer asked for this/);
    expect(answerQuestion('how do I set up birthday offers', branchOwner).answer).toMatch(/This branch only/);
  });

  it('every knowledge entry is complete', () => {
    for (const entry of KNOWLEDGE) {
      expect(entry.id && entry.title && entry.answer && entry.keywords.length && entry.audiences.length).toBeTruthy();
    }
  });
});

describe('Inventory add-on topics', () => {
  const withInventory = (who) => ({ ...who, addons: ['inventory'] });
  const inventoryLogin = { audience: 'INVENTORY', name: 'Suresh', branch: 'Andheri', salon: 'Glamour Studio', addons: ['inventory'] };

  it('answers the three PRD questions', () => {
    expect(answerQuestion('How do I set up inventory?', withInventory(owner)).topicId).toBe('inventory-setup');
    expect(answerQuestion('how do I mark a bottle finished?', withInventory(desk)).topicId).toBe('inventory-finish');
    expect(answerQuestion('why didn’t a service deduct stock?', inventoryLogin).topicId).toBe('inventory-no-deduction');
  });

  it('gives the front desk their own steps, and inventory logins theirs', () => {
    expect(answerQuestion('a bottle broke, how do I write off', withInventory(desk)).answer).toMatch(/Report a problem/);
    expect(answerQuestion('change a recipe', inventoryLogin).answer).toMatch(/Only the owners change them/);
    expect(answerQuestion('how do I book an appointment', inventoryLogin).kind).toBe('not-allowed');
  });

  it('tells salons without the add-on that it is a paid add-on', () => {
    const reply = answerQuestion('How do I set up inventory?', { ...owner, addons: [] });
    expect(reply.kind).toBe('not-allowed');
    expect(reply.answer).toMatch(/paid add-on/);
  });
});
