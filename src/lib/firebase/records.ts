import { db } from './config';
import { 
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, Timestamp 
} from 'firebase/firestore';
import type { Record, RecordType } from '../utils/types';
import { format } from 'date-fns';

// 月別コレクション名を生成
const getMonthlyCollectionName = (date: Date): string => {
  return format(date, 'yyyy-MM');
};

// 記録コレクションへの参照を取得
export const getRecordsCollection = (memberId: string, date: Date) => {
  const monthCollection = getMonthlyCollectionName(date);
  return collection(db, 'records', memberId, monthCollection);
};

// 記録を追加
export const addRecord = async (memberId: string, type: RecordType, timestamp: Date = new Date()): Promise<string> => {
  try {
    console.log('記録追加開始:', { memberId, type, timestamp });
    const recordsCollection = getRecordsCollection(memberId, timestamp);
    console.log('コレクション参照:', recordsCollection.path);
    
    const record: any = {
      type,
      timestamp: Timestamp.fromDate(timestamp),
      memberId,
      deleted: false
    };

    // 'out'の場合、最後の'in'記録を検索して滞在時間を計算
    if (type === 'out') {
      console.log('退出処理: 最後の入室記録を検索');
      const lastInRecord = await getLastInRecord(memberId);
      console.log('最後の入室記録:', lastInRecord);
      
      if (lastInRecord) {
        // 滞在時間（分）を計算
        const durationMinutes = Math.round(
          (timestamp.getTime() - lastInRecord.timestamp.getTime()) / (1000 * 60)
        );
        console.log('滞在時間（分）:', durationMinutes);
        
        // 負の値にならないように最小値を0に設定
        record.duration = Math.max(0, durationMinutes);
        
        // 日をまたいでいるかチェック
        const inDate = format(lastInRecord.timestamp, 'yyyy-MM-dd');
        const outDate = format(timestamp, 'yyyy-MM-dd');
        console.log('日付チェック:', { inDate, outDate });
        
        // recordに元の入室時刻を保存（統計計算用）
        record.inTimestamp = Timestamp.fromDate(lastInRecord.timestamp);
        
        // 日をまたいでいる場合、flgを設定
        if (inDate !== outDate) {
          record.crossesDays = true;
          console.log('日をまたいでいる記録を検出');
        }
      } else {
        console.log('対応する入室記録が見つかりません');
        // 対応する'in'記録がない場合はデフォルト0を設定
        record.duration = 0;
      }
    }
    
    console.log('保存するレコード:', record);
    const docRef = await addDoc(recordsCollection, record);
    console.log('記録の追加完了:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('Failed to add record:', error);
    throw new Error('記録の追加に失敗しました。再度お試しください。');
  }
};

// 最後の'in'記録を取得
export const getLastInRecord = async (memberId: string): Promise<Record | null> => {
  // 最近の2ヶ月分をチェック
  const currentDate = new Date();
  console.log('最後の入室記録を検索開始:', { memberId, currentDate: format(currentDate, 'yyyy-MM-dd') });
  
  const months = [0, -1].map(offset => {
    const date = new Date(currentDate);
    date.setMonth(date.getMonth() + offset);
    return date;
  });
  console.log('検索対象の月:', months.map(date => format(date, 'yyyy-MM')));
  
  // 各月の記録を取得
  const monthQueries = months.map(date => {
    const recordsCollection = getRecordsCollection(memberId, date);
    console.log('コレクション参照:', recordsCollection.path);
    return query(
      recordsCollection,
      where('type', '==', 'in'),
      orderBy('timestamp', 'desc'),
      limit(1)
    );
  });
  
  // すべてのクエリを並列で実行
  const snapshots = await Promise.all(monthQueries.map(q => getDocs(q)));
  console.log('クエリ結果:', snapshots.map(snapshot => snapshot.size));
  
  // 各月の最新の'in'記録を集める
  const records = snapshots
    .flatMap(snapshot => 
      snapshot.docs.map(doc => {
        const data = doc.data();
        if (!data.deleted) {
          return {
            id: doc.id,
            memberId: data.memberId,
            type: data.type,
            timestamp: data.timestamp.toDate()
          };
        }
        return null;
      })
    )
    .filter((record): record is Record => record !== null);
  
  console.log('見つかった入室記録:', records.length);
  
  // タイムスタンプでソートして最新のものを返す
  if (records.length > 0) {
    const latestRecord = records.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
    console.log('最新の入室記録:', {
      id: latestRecord.id,
      timestamp: format(latestRecord.timestamp, 'yyyy-MM-dd HH:mm:ss')
    });
    return latestRecord;
  }
  
  console.log('入室記録が見つかりませんでした');
  return null;
};

// メンバーの最近の記録を取得（直近1週間）
export const getRecentRecords = async (memberId: string, days: number = 7): Promise<Record[]> => {
  const currentDate = new Date();
  const startDate = new Date(currentDate);
  startDate.setDate(startDate.getDate() - days);
  
  // 月をまたぐ可能性があるので、現在月と前月を検索
  const thisMonth = getRecordsCollection(memberId, currentDate);
  const lastMonth = new Date(currentDate);
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const prevMonth = getRecordsCollection(memberId, lastMonth);
  
  // 両方の月から記録を取得
  const qThisMonth = query(
    thisMonth,
    where('timestamp', '>=', Timestamp.fromDate(startDate)),
    orderBy('timestamp', 'desc')
  );
  
  const qPrevMonth = query(
    prevMonth,
    where('timestamp', '>=', Timestamp.fromDate(startDate)),
    orderBy('timestamp', 'desc')
  );
  
  const [thisMonthSnapshot, prevMonthSnapshot] = await Promise.all([
    getDocs(qThisMonth),
    getDocs(qPrevMonth)
  ]);
  
  // 結果を結合して日付順にソート
  const records = [
    ...thisMonthSnapshot.docs,
    ...prevMonthSnapshot.docs
  ]
    .filter(doc => {
      const data = doc.data();
      return !data.deleted; // deletedがtrueでないものを含める
    })
    .map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        memberId: data.memberId,
        type: data.type,
        timestamp: data.timestamp.toDate(),
        duration: data.duration
      };
    });
  
  return records.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
};

// 期間の記録を取得（統計用）
export const getRecordsForPeriod = async (
  memberId: string, 
  startDate: Date, 
  endDate: Date
): Promise<Record[]> => {
  // サーバー時刻とのずれを考慮して日付範囲に余裕を持たせる
  const adjustedStartDate = new Date(startDate);
  adjustedStartDate.setDate(adjustedStartDate.getDate() - 1);
  
  const adjustedEndDate = new Date(endDate);
  adjustedEndDate.setDate(adjustedEndDate.getDate() + 1);
  
  console.log('検索期間（調整前）:', {
    startDate: format(startDate, 'yyyy-MM-dd'),
    endDate: format(endDate, 'yyyy-MM-dd')
  });
  
  console.log('検索期間（調整後）:', {
    adjustedStartDate: format(adjustedStartDate, 'yyyy-MM-dd'),
    adjustedEndDate: format(adjustedEndDate, 'yyyy-MM-dd')
  });
  
  // 期間内の全ての月を取得
  const months: Date[] = [];
  const startMonth = new Date(adjustedStartDate.getFullYear(), adjustedStartDate.getMonth(), 1);
  const endMonth = new Date(adjustedEndDate.getFullYear(), adjustedEndDate.getMonth(), 1);
  
  console.log('検索対象の月範囲:', {
    startMonth: format(startMonth, 'yyyy-MM'),
    endMonth: format(endMonth, 'yyyy-MM')
  });
  
  // 開始月から終了月までの全ての月を取得
  let currentMonth = new Date(startMonth);
  while (currentMonth <= endMonth) {
    months.push(new Date(currentMonth));
    console.log('検索対象の月:', format(currentMonth, 'yyyy-MM'));
    // 次の月に進める
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  }
  
  console.log('検索対象の月一覧:', months.map(date => format(date, 'yyyy-MM')));
  
  // 各月のクエリを作成
  const queries = months.map(date => {
    const recordsCollection = getRecordsCollection(memberId, date);
    console.log('コレクション参照:', recordsCollection.path);
    
    return query(
      recordsCollection,
      where('timestamp', '>=', Timestamp.fromDate(startDate)),
      where('timestamp', '<=', Timestamp.fromDate(endDate)),
      orderBy('timestamp')
    );
  });
  
  // すべてのクエリを実行
  const snapshots = await Promise.all(queries.map(q => getDocs(q)));
  
  // 結果を結合
  const records: Record[] = [];
  
  snapshots.forEach((snapshot, index) => {
    console.log(`月 ${format(months[index], 'yyyy-MM')} の記録数:`, snapshot.size);
    
    snapshot.docs
      .filter(doc => {
        const data = doc.data();
        return !data.deleted; // deletedがtrueでないものを含める
      })
      .forEach(doc => {
        const data = doc.data();
        records.push({
          id: doc.id,
          memberId: data.memberId,
          type: data.type,
          timestamp: data.timestamp.toDate(),
          duration: data.duration
        });
      });
  });
  
  console.log('取得した記録の総数:', records.length);
  
  // タイムスタンプでソート
  return records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
};

// 記録を更新
export const updateRecord = async (
  memberId: string, 
  recordId: string, 
  date: Date,
  data: { type?: RecordType; timestamp?: Date; duration?: number }
): Promise<void> => {
  const recordsCollection = getRecordsCollection(memberId, date);
  const recordRef = doc(recordsCollection, recordId);
  
  const updateData: any = {};
  
  if (data.type) {
    updateData.type = data.type;
  }
  
  if (data.timestamp) {
    updateData.timestamp = Timestamp.fromDate(data.timestamp);
  }
  
  if (data.duration !== undefined) {
    updateData.duration = data.duration;
  }
  
  await updateDoc(recordRef, updateData);
};

// 記録を削除
export const deleteRecord = async (
  memberId: string, 
  recordId: string, 
  date: Date
): Promise<void> => {
  const recordsCollection = getRecordsCollection(memberId, date);
  const recordRef = doc(recordsCollection, recordId);
  await updateDoc(recordRef, {
    deleted: true
  });
};

// 記録一覧を取得
export const getRecords = async (
  memberId: string,
  date: Date
): Promise<Record[]> => {
  try {
    const recordsCollection = getRecordsCollection(memberId, date);
    const q = query(recordsCollection);
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.docs
      .filter(doc => {
        const data = doc.data();
        return !data.deleted; // deletedがtrueでないものを含める
      })
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate()
      })) as Record[];
  } catch (error) {
    console.error('Failed to fetch records:', error);
    throw new Error('記録の取得に失敗しました。再度お試しください。');
  }
};