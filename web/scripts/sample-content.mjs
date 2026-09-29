// Source text for the three bundled sample documents. All original writing for
// the AI Summary demo. The study is fictional and says so on its first page.

export const study = {
  title: 'Spacing Out: Retrieval Practice, Sleep and Exam Performance in an Introductory Programming Course',
  authors: 'Dara Sok and Mei Lin Tan · Learning Sciences Demo Lab',
  notice: 'Sample document for the AI Summary demo. The study, participants and data are fictional.',
  abstract:
    'Students in introductory programming courses often prepare for exams by re-reading notes in the days before the test. ' +
    'We compared this massed review with spaced retrieval practice, in which students answered short low-stakes quizzes spread across the term. ' +
    'In a fictional cohort of 212 first-year students, the spaced retrieval group scored 78% on the final exam, compared with 64% for the massed review group, a difference of 14 percentage points (Cohen’s d = 0.62). ' +
    'Students who reported at least seven hours of sleep before the exam retained more of what they had practised, and the benefit of spacing was largest for students who also slept well. ' +
    'We argue that course designers can build retrieval practice and sleep-aware deadlines directly into the structure of a course.',
  sections: [
    {
      heading: '1 Introduction',
      paragraphs: [
        'Learning to program asks students to hold many new ideas in mind at once: variables, control flow, functions and the habits of debugging. ' +
          'Many students respond by cramming, spending long sessions re-reading slides shortly before an exam. Re-reading feels productive because the material looks familiar, but familiarity is not the same as being able to recall and apply an idea.',
        'Two findings from memory research suggest a better approach. Retrieval practice is the act of recalling information from memory, for example by answering a quiz question without looking at notes, and it strengthens later recall more than re-reading. ' +
          'The spacing effect describes the observation that practice distributed over several days produces more durable learning than the same amount of practice massed into one session. ' +
          'Sleep also matters, because memories are consolidated during sleep after learning.',
        'This study asks whether combining spaced retrieval practice with attention to sleep improves exam performance in a first-year programming course, and whether the two factors interact.',
      ],
    },
    {
      heading: '2 Method',
      paragraphs: [
        'The fictional cohort included 212 first-year students enrolled in an introductory Python course over a twelve-week term. Students were randomly assigned by tutorial group to one of two study conditions.',
        'In the spaced retrieval condition, students completed a ten-question online quiz every Tuesday and Friday. Each quiz mixed questions from the current week with questions from earlier weeks, and students received feedback immediately after answering.',
        'In the massed review condition, students received the same questions as a printed study guide with worked answers, and were encouraged to review it before the exam. Both groups had access to identical lectures, labs and teaching assistants.',
        'Students kept a short sleep diary during the final week, recording the hours they slept each night. The final exam contained 40 questions on reading, tracing and writing code, and was marked by teaching assistants who did not know which condition each student belonged to.',
      ],
    },
    {
      heading: '3 Results',
      paragraphs: [
        'Students in the spaced retrieval group averaged 78% on the final exam, while students in the massed review group averaged 64%. The difference of 14 percentage points corresponds to a medium-to-large effect size (d = 0.62).',
        'The benefit was clearest on code-writing questions, where the spaced retrieval group scored 21 percentage points higher. On simple definition questions the gap was only 6 points, which suggests that retrieval practice mainly helped students apply ideas rather than recognise them.',
        'Sleep was associated with better performance in both groups. Students who slept at least seven hours on the night before the exam scored 9 points higher on average than students who slept less than five hours.',
        'The two factors interacted: spaced retrieval students who also slept well scored highest, averaging 84%. In contrast, 31% of students in the massed review group reported studying past midnight before the exam, and this group had the lowest average score at 57%.',
      ],
    },
    {
      heading: '4 Discussion',
      paragraphs: [
        'The results support a simple conclusion: students learn programming more durably when they repeatedly retrieve ideas over time, and when they protect their sleep before assessments. ' +
          'Frequent low-stakes quizzes turn every week into a small opportunity to practise recall, and mixing older questions into new quizzes provides spacing without extra planning from students.',
        'Course design can make these habits the default. Instructors can schedule short weekly quizzes, move assignment deadlines away from late-night submission times, and avoid scheduling major deadlines on the night before an exam.',
      ],
    },
    {
      heading: '5 Limitations',
      paragraphs: [
        'Because the data are fictional and the sleep measure is self-reported, the numbers should be read as an illustration rather than evidence. ' +
          'A real study would also need to account for prior programming experience, attendance and motivation, which can differ between tutorial groups.',
      ],
    },
    {
      heading: '6 Conclusion',
      paragraphs: [
        'Spaced retrieval practice produced higher exam scores than massed review, and the advantage was largest for students who slept at least seven hours before the exam. ' +
          'Building retrieval practice and sleep-aware deadlines into a course is a low-cost way to help novice programmers learn more.',
      ],
    },
    {
      heading: 'References',
      paragraphs: [
        'Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., and Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. Psychological Bulletin, 132(3), 354–380.',
        'Roediger, H. L., and Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. Psychological Science, 17(3), 249–255.',
      ],
    },
  ],
};

export const notes = {
  title: 'Recall App — Sprint 7 Planning Notes',
  meta: [
    ['Date', 'Tuesday, 14 October 2026, 4:00–5:15 pm'],
    ['Attendees', 'Sophea Chan (product), Vuthy Lim (mobile), Anika Rao (backend), Jonah Mercer (design), Lina Ouk (research)'],
    ['Apologies', 'Kosal Heng'],
  ],
  sections: [
    {
      heading: 'Context',
      paragraphs: [
        'Recall is a student-built flashcard app for first-year courses. Usage grew to 1,850 weekly active students after the midterm, but only 22% of new users complete a second review session. Sprint 7 focuses on bringing learners back at the right time instead of adding new features.',
      ],
    },
    {
      heading: 'Discussion',
      paragraphs: [
        'Lina summarised the learning-science research behind the sprint. Spaced repetition works best when reviews are scheduled just before a student is likely to forget, and quizzing yourself (retrieval practice) beats re-reading. She suggested mixing older cards into each session rather than showing only new material.',
        'Anika proposed replacing the fixed three-day review interval with an adaptive scheduler. Cards answered correctly would move to longer intervals (1, 3, 7, 16 and 35 days), while missed cards return the next day. The team agreed the scheduler must run on the device so it keeps working offline.',
        'Jonah shared new designs for the review screen. The main change is a single "Review 12 cards" button on the home screen and a calmer end-of-session summary. Several people felt that streak counters encouraged cramming, so streaks will be replaced by a weekly consistency chart.',
        'Vuthy raised the risk that push notifications at night could hurt sleep before exams. The team agreed that reminders should never be sent after 9:30 pm local time, and that students can pause reminders during exam week.',
        'Sophea reviewed the budget. The research budget is $1,200 for the semester: $900 for usability-test gift cards and $300 for a transcription service. Analytics will stay privacy-first — no third-party trackers, and only aggregated counts leave the device.',
      ],
    },
    {
      heading: 'Decisions',
      bullets: [
        'Adopt the adaptive spaced repetition scheduler for all decks, with intervals of 1, 3, 7, 16 and 35 days.',
        'Replace streaks with a weekly consistency chart.',
        'No reminders after 9:30 pm; add an exam-week pause.',
        'Run five moderated usability tests before the public release.',
      ],
    },
    {
      heading: 'Action items',
      table: [
        ['Owner', 'Task', 'Due'],
        ['Anika Rao', 'Implement the on-device scheduler and migrate existing review data', 'Friday, 24 October 2026'],
        ['Jonah Mercer', 'Finalise review screen and consistency chart designs', 'Monday, 20 October 2026'],
        ['Vuthy Lim', 'Add quiet hours and exam-week pause to notifications', 'Wednesday, 22 October 2026'],
        ['Lina Ouk', 'Recruit five students and write the usability test script', 'Thursday, 23 October 2026'],
        ['Sophea Chan', 'Confirm the transcription vendor within the $300 budget', 'Friday, 17 October 2026'],
      ],
    },
    {
      heading: 'Risks',
      bullets: [
        'Migrating review history could reset some students’ progress; Anika will ship a dry-run export first.',
        'If fewer than five students sign up for testing, the release date of 3 November 2026 may slip by one week.',
      ],
    },
    {
      heading: 'Next meeting',
      paragraphs: ['The next sprint review is on Tuesday, 28 October 2026 at 4:00 pm. Lina will present the first usability findings.'],
    },
  ],
};

export const article = `---
title: The Lake That Breathes
---

# The Lake That Breathes

*How the Tonlé Sap reverses its flow every year — and why Cambodia depends on it.*

Most rivers flow in one direction. Once a year, the Tonlé Sap River in Cambodia turns around. For a few months it runs backwards, carrying water away from the sea and into the largest freshwater lake in Southeast Asia. The lake swells, the forest around it floods, and a whole economy of fish, rice and floating villages follows the water. People sometimes call it the lake that breathes.

## How the reversal works

The Tonlé Sap River links the lake to the Mekong River at Phnom Penh. For most of the year, water drains from the lake down the river and into the Mekong. From around June, the monsoon rains and snowmelt from the Tibetan Plateau raise the Mekong so high that it pushes water up the Tonlé Sap River instead, and the flow reverses.

Through the wet season the Mekong keeps feeding the lake. Around October, as the Mekong falls, the pressure eases and the river turns again, draining the lake back towards the delta in Vietnam. This annual flood pulse is the heartbeat of the whole system.

## A shoreline that moves

The numbers are approximate, but the scale is striking. In the dry season the lake covers roughly 2,500 square kilometres and is often only about a metre deep. At the height of the flood it can spread across more than 10,000 square kilometres and reach depths of around nine metres. Villages that sit at the lake's edge in March may be kilometres from open water by May, and surrounded by it in September.

The flooded forest that fringes the lake is essential. When the water rises, fish move out of the Mekong and into the submerged trees and grasslands, where they feed and spawn. When the water retreats, it leaves behind fertile sediment on the fields.

## Fish, rice and floating villages

The Tonlé Sap supports one of the most productive inland fisheries in the world, and fish provides a large share of the protein in the Cambodian diet. Many families live in floating villages, in houses built on boats or bamboo rafts that rise and fall with the water. Others live in stilt houses that stand ten metres above the dry-season ground.

Farmers plant rice as the flood recedes, using the moisture and nutrients left in the soil. Fish caught during the migration are turned into prahok, a fermented fish paste that keeps for months and flavours countless Cambodian dishes.

The lake was designated a UNESCO Biosphere Reserve in 1997, recognising both its biodiversity and the communities that depend on it.

## Bon Om Touk

Cambodians celebrate the reversal of the river with Bon Om Touk, the Water Festival, held over several days around the full moon in November. Hundreds of long, brightly painted racing boats compete on the river in Phnom Penh, and the festival marks the moment when the water begins to flow back out of the lake and the fishing season opens.

## Pressures upstream

The lake's rhythm depends on water that falls hundreds of kilometres away. Hydropower dams on the Mekong and its tributaries store water in the wet season and release it in the dry season, which can flatten the flood pulse that the lake needs. Climate change is making rainfall less predictable, and clearing of the flooded forest removes the nurseries that fish depend on.

Researchers have warned that a weaker flood pulse would mean fewer fish, less fertile farmland and greater risk for the families who live on the water. Overfishing adds further pressure, especially when catches fall and people must fish harder to earn the same income.

## What comes next

Protecting the Tonlé Sap is a regional problem as much as a national one. The Mekong River Commission, created in 1995 by Cambodia, Laos, Thailand and Vietnam, shares data and reviews dam proposals, although it cannot block them. Community fisheries, where villages manage their own fishing grounds, have shown that local rules can help fish populations recover.

The lake has breathed in and out for thousands of years. Whether it keeps doing so will depend on decisions made far upstream, and on whether the people who depend on the lake have a voice in them.
`;
