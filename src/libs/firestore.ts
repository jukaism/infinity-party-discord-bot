import * as fb from 'firebase-admin'
import * as config from '../../config.json'

const sa: fb.ServiceAccount = {
  projectId: config.firebase.serviceAccount.projectId,
  privateKey: config.firebase.serviceAccount.privateKey,
  clientEmail: config.firebase.serviceAccount.clientEmail,
}

fb.initializeApp({ credential: fb.credential.cert(sa) })
const store = fb.firestore()
const channelRef = store.collection('channel')

const main = async () => {
  const commander = await channelRef.doc('1078944765632061520').get()
  const lowerBound = '1114524369033646080'
  const upperBound = '1244582794299183216'

  // サブコレクションを削除する関数
  async function deleteSubcollections(docRef) {
    const subcollections = await docRef.listCollections()

    for (const subcollection of subcollections) {
      await deleteCollection(subcollection)
    }
  }

  // コレクション内のドキュメントを削除する関数
  async function deleteCollection(ref) {
    const snapshot = await ref.get()

    if (snapshot.empty) {
      return
    }

    const batch = store.batch()
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref)
    })

    await batch.commit()
  }

  // 指定範囲のドキュメントとそのサブコレクションを削除する関数
  async function deleteDocumentsInRange() {
    const query = channelRef
      .where(fb.firestore.FieldPath.documentId(), '>', lowerBound)
      .where(fb.firestore.FieldPath.documentId(), '<', upperBound)

    const snapshot = await query.get()

    if (snapshot.empty) {
      console.log('No matching documents.')
      return
    }

    for (const doc of snapshot.docs) {
      await deleteSubcollections(doc.ref)
      await doc.ref.delete()
    }

    console.log('Documents and subcollections deleted successfully.')
  }

  deleteDocumentsInRange().catch((err) => {
    console.error('Error deleting documents and subcollections: ', err)
  })
}

// main()
const sub = async () => {
  async function deleteSubcollections(docId) {
    const docRef = channelRef.doc(String(docId))
    const subcollections = await docRef.listCollections()

    for (const subcollection of subcollections) {
      await deleteCollection(subcollection)
    }
  }

  async function deleteCollection(ref) {
    const snapshot = await ref.get()

    if (snapshot.empty) {
      return
    }
    console.warn(snapshot)
    const batch = store.batch()
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref)
    })

    await batch.commit()
  }

  // 事前に知っている残ったサブコレクションのドキュメントIDをここに追加
  const remainingDocIds = []

  async function deleteRemainingSubcollections() {
    for (const docId of remainingDocIds) {
      await deleteSubcollections(docId)
    }

    console.log('Remaining subcollections deleted successfully.')
  }

  deleteRemainingSubcollections().catch((err) => {
    console.error('Error deleting remaining subcollections: ', err)
  })
}
// sub()
