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

  it('every knowledge entry is complete', () => {
    for (const entry of KNOWLEDGE) {
      expect(entry.id && entry.title && entry.answer && entry.keywords.length && entry.audiences.length).toBeTruthy();
    }
  });
});
